// Set-wide / registry-parity tests for `convex/cards/sets/3ed/` (ADR 0043).
//
// 3ED (Revised Edition) is a 100% reprint set — it introduces no new cards, so
// the modules are entirely CardPrint entries that resolve
// printId -> definitionId -> a shared CardDefinition already implemented in
// lea/leb/arn/atq/leg/drk (ADR 0014). The module-load guard in index.ts already
// throws on a dangling printId; these assertions make the reprint contract
// explicit and verify that Revised shows up as an extra printing alongside the
// originals. The 3 ante cards (Contract from Below, Darkpact, Demonic Attorney)
// are permanently out of scope (ADR 0010) and carry no print row.
//
// Per ADR 0043 the set-wide invariants live with the colorless (catch-all)
// module; the set has no per-card behavioural tests (every card is a reprint).

import { describe, it, expect } from "vitest";
import {
    airElemental3ed,
    lightningBolt3ed,
    volcanicIsland3ed,
    circleOfProtectionBlack3ed,
    mountain3ed,
} from "..";
import { airElemental, lightningBolt, mountain } from "../../lea";
import { volcanicIsland, circleOfProtectionBlack } from "../../leb";
import {
    getDefinition,
    getPrintingsForCard,
    getAllSetCodes,
    tryGetCardByName,
} from "../../../index";
import { setName } from "../../../setMeta";
import { validateDeck } from "../../../../formats";
import type { ValidatableDeck } from "../../../../formats";
import * as revised from "..";
import type { CardPrint } from "../../../types";

const ALL_3ED = Object.values(revised).filter(
    (v): v is CardPrint => typeof v === "object" && v !== null && "printId" in v
);

describe("3ED registry parity (ADR 0014)", () => {
    it("resolves reprint prints to their shared LEA definition", () => {
        expect(getDefinition(airElemental3ed.printId)).toBe(airElemental);
        expect(getDefinition(lightningBolt3ed.printId)).toBe(lightningBolt);
    });

    it("resolves Beta-original reprints to their LEB definition", () => {
        // Volcanic Island and Circle of Protection: Black never existed in
        // Alpha — their CardDefinition lives in leb, and Revised reprints it.
        expect(getDefinition(volcanicIsland3ed.printId)).toBe(volcanicIsland);
        expect(getDefinition(circleOfProtectionBlack3ed.printId)).toBe(
            circleOfProtectionBlack
        );
    });

    it("resolves every 3ed print to its shared definition", () => {
        for (const print of ALL_3ED) {
            expect(() => getDefinition(print.printId)).not.toThrow();
        }
    });

    it("contains 288 non-basic prints plus basic-land art variants", () => {
        const basicDefIds = new Set(
            ["Plains", "Island", "Swamp", "Mountain", "Forest"].map(
                (n) => tryGetCardByName(n)!.id
            )
        );
        const nonBasic = ALL_3ED.filter(
            (p) => !basicDefIds.has(p.definitionId)
        );
        const basics = ALL_3ED.filter((p) => basicDefIds.has(p.definitionId));
        expect(nonBasic).toHaveLength(288);
        // 5 basics x 3 art variants = 15.
        expect(basics).toHaveLength(15);
    });

    it("excludes the 3 ante cards (ADR 0010)", () => {
        const anteDefIds = new Set(
            ["Contract from Below", "Darkpact", "Demonic Attorney"]
                .map((n) => tryGetCardByName(n)?.id)
                .filter((id): id is string => Boolean(id))
        );
        for (const print of ALL_3ED) {
            expect(anteDefIds.has(print.definitionId)).toBe(false);
        }
    });
});

describe("3ED as an extra printing", () => {
    it("appends Revised to the original printing list, original first", () => {
        const printings = getPrintingsForCard(lightningBolt.id);
        expect(printings[0].setCode).toBe("lea");
        expect(printings).toContainEqual({
            printId: lightningBolt3ed.printId,
            setCode: "3ed",
        });
    });

    it("is included in the catalogue's set codes", () => {
        expect(getAllSetCodes()).toContain("3ed");
    });
});

describe("3ED display name (#561)", () => {
    it("maps the 3ed code to its human-readable name", () => {
        expect(setName("3ed")).toBe("Revised Edition");
        // case-insensitive, no upper-cased fallback
        expect(setName("3ED")).toBe("Revised Edition");
    });
});

describe("3ED Old School legality (#561)", () => {
    it("validates a 60-card Old School deck built around a Revised reprint", () => {
        // 1 Revised Bolt + 59 basics resolves and validates legal end-to-end
        // via the real registry resolver.
        const deck: ValidatableDeck = {
            cards: [
                {
                    cardId: lightningBolt3ed.printId,
                    cardName: "Lightning Bolt",
                },
                ...Array.from({ length: 59 }, () => ({
                    cardId: mountain3ed.printId,
                    cardName: "Mountain",
                })),
            ],
        };
        const result = validateDeck(deck, "old-school");
        expect(result.isLegal).toBe(true);
        expect(result.reasons).toEqual([]);
    });
});

// Defensive: the basic-land definition import must stay referenced so the test
// fails loudly if the Mountain reprint ever points at the wrong definition.
describe("3ED basic-land reprints", () => {
    it("resolves Mountain art variants to the shared Mountain definition", () => {
        expect(getDefinition(mountain3ed.printId)).toBe(mountain);
    });
});
