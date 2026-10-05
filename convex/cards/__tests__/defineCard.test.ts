/**
 * Issue #4857 (PRD #4849, ADR 0113 Amendment IV) — a hand-written Card
 * Definition declared with `defineCard(() => ({ … }))` is a memoised factory:
 * built on the first request, the same object afterwards, and resolved by the
 * catalogue exactly as an eagerly declared definition is.
 *
 * The converted cards cover the three shapes the issue names: Breath of
 * Darigaaz (a `resolve()` card), Aura Blast (an Effect Script) and Witch
 * Enchanter (a modal double-faced card, CR 712, whose back face is a derived
 * twin). Lightning Bolt is the eager control.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
    getAllCards,
    getCardByName,
    getDefinitionSetCode,
    isPrintedInSet,
    resolveDeckCardMeta,
    tryGetCardByName,
    tryGetPlaceableCardByName,
    walkHandWrittenDefinitions,
} from "../catalogue";
import { defineCard, isCardFactory, type CardFactory } from "../types";
import { modalBackFaceDefinitionId } from "../modalDfc";
import { expandDefinition, getDefinition, tryGetDefinition } from "../registry";
import type { CardDefinition } from "../types";
import { breathOfDarigaaz } from "../sets/inv/red.cards";
import { auraBlast } from "../sets/pls/white.cards";
import { witchEnchanter } from "../sets/mom/white.cards";
import { lightningBolt } from "../sets/lea/red.cards";

const FACTORIES = { breathOfDarigaaz, auraBlast, witchEnchanter };

describe("defineCard", () => {
    it("builds on the first call, never before, and returns the same object after", () => {
        let calls = 0;
        const card = defineCard(() => {
            calls++;
            return { ...lightningBolt, id: "define-card-probe" };
        });
        expect(isCardFactory(card)).toBe(true);
        expect(calls).toBe(0);
        expect(card.builds()).toBe(0);
        const first = card();
        expect(card()).toBe(first);
        expect(calls).toBe(1);
        expect(card.builds()).toBe(1);
    });

    it("tells a factory from an eager definition and from a plain function", () => {
        expect(isCardFactory(auraBlast)).toBe(true);
        expect(isCardFactory(lightningBolt)).toBe(false);
        expect(isCardFactory(() => lightningBolt)).toBe(false);
    });
});

/** One card as its Set module declares it: the factory's built object, or the
 *  eager export itself. */
const declared: [string, () => CardDefinition, string][] = [
    ["Breath of Darigaaz", () => breathOfDarigaaz(), "inv"],
    ["Aura Blast", () => auraBlast(), "pls"],
    ["Witch Enchanter", () => witchEnchanter(), "mom"],
    ["Lightning Bolt", () => lightningBolt, "lea"],
];

describe("the catalogue resolves a factory card as it resolves an eager one (issue #4857)", () => {
    it.each(declared)(
        "%s: the same object through every id, name and Set lookup",
        (name, raw, setCode) => {
            const def = raw();
            // Two requests, one object: identity is stable.
            expect(raw()).toBe(def);
            expect(getCardByName(name)).toBe(def);
            expect(tryGetCardByName(name)).toBe(def);
            expect(tryGetPlaceableCardByName(name)).toBe(def);

            const expanded = getDefinition(def.id);
            expect(expanded).toBe(expandDefinition(def));
            expect(getDefinition(def.id)).toBe(expanded);
            expect(tryGetDefinition(def.id)).toBe(expanded);
            expect(getAllCards()).toContain(expanded);

            expect(getDefinitionSetCode(def.id)).toBe(setCode);
            expect(isPrintedInSet(def.id, setCode)).toBe(true);
            expect(resolveDeckCardMeta(def.id)).toMatchObject({
                cardId: def.id,
                name,
                setCode,
            });
            expect(
                walkHandWrittenDefinitions().filter(
                    (e) => e.definition.id === def.id
                )
            ).toEqual([expect.objectContaining({ setCode, definition: def })]);
        }
    );

    it("derives a factory card's modal back face (CR 712.8f) and resolves its name to the card (CR 712.8a)", () => {
        const front = witchEnchanter();
        const back = tryGetCardByName("Witch-Blessed Meadow");
        expect(back?.id).toBe(modalBackFaceDefinitionId(front.id));
        expect(back?.types).toEqual(["Land"]);
        expect(tryGetPlaceableCardByName("Witch-Blessed Meadow")).toBe(
            getDefinition(front.id)
        );
    });
});

describe("a factory card is built only when requested — a fresh module graph (issue #4857)", () => {
    // FRESH, because in this worker the setup's freeze walk asked for every
    // hand-written card, and so built every factory.
    let fresh: typeof import("../index");
    let factories: Record<keyof typeof FACTORIES, CardFactory>;
    beforeAll(async () => {
        vi.resetModules();
        try {
            fresh = await import("../index");
            factories = {
                breathOfDarigaaz: (await import("../sets/inv/red.cards"))
                    .breathOfDarigaaz,
                auraBlast: (await import("../sets/pls/white.cards")).auraBlast,
                witchEnchanter: (await import("../sets/mom/white.cards"))
                    .witchEnchanter,
            };
        } finally {
            // The next file in this worker (`isolate: false`) must not
            // inherit this graph from the module cache.
            vi.resetModules();
        }
    }, 120_000);

    it("loading the catalogue builds none; one request builds one, once", () => {
        // Not the worker's own factories: the fresh graph has its own.
        expect(factories.auraBlast).not.toBe(auraBlast);
        for (const factory of Object.values(factories)) {
            expect(factory.builds()).toBe(0);
        }

        const id = auraBlast().id;
        const def = fresh.getDefinition(id);
        expect(factories.auraBlast.builds()).toBe(1);
        // Every later request — by id, by name, the raw walk — is served by
        // the memo, never by a second build.
        expect(fresh.getDefinition(id)).toBe(def);
        expect(fresh.tryGetDefinition(id)).toBe(def);
        expect(fresh.getCardByName("Aura Blast")).toBe(factories.auraBlast());
        expect(fresh.getCardByName("Aura Blast")).toBe(
            fresh.getCardByName("Aura Blast")
        );
        expect(factories.auraBlast.builds()).toBe(1);
        // The request built the card it asked for, and no other.
        expect(factories.breathOfDarigaaz.builds()).toBe(0);
        expect(factories.witchEnchanter.builds()).toBe(0);
    });
});
