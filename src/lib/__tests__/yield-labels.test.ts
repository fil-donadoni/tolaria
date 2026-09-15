// Issue #3629 — the "Manage yields" box's labels: a **Yield** key read back into
// a source name, a kind and the ability's own text, never a raw key or a
// definition id.
//
// Every key is minted by `yieldKeyForStackItem` from the REAL projection
// (`projectPublicState`), never hand-written, so the label derivation is tested
// against keys the client can actually hold.
import { describe, it, expect } from "vitest";
import { makeInstance, makeState } from "@convex/cards/__tests__/setup";
import { getCardByName } from "@convex/cards";
import { MONARCH_DESIGNATION } from "@convex/cards/designations";
import { CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID } from "@convex/cards/emblems";
import { INLINE_DELAYED_TRIGGER_ID } from "@convex/gre/effects/interpreter";
import { projectPublicState } from "@convex/gameProjections";
import type {
    GameState,
    StackItem as EngineStackItem,
} from "@convex/gre/state";
import type { StackItem } from "~/types/game";
import { parseYieldKey, yieldKeyForStackItem } from "~/lib/yields";
import {
    triggerOrderSourceNames,
    yieldKeyLabel,
    yieldRows,
} from "~/lib/yield-labels";

const BOLT = getCardByName("Lightning Bolt");
const ROCK_HYDRA = getCardByName("Rock Hydra");
const NOBLE = getCardByName("Noble Hierarch");
const IGNOBLE = getCardByName("Ignoble Hierarch");
const FARRELITE = getCardByName("Farrelite Priest");

/** A stack object of `defId`, with `extra` laid over it (ability ids, or a
 *  card-less identity for a designation / emblem source). */
function engineItem(
    defId: string,
    extra: Partial<EngineStackItem> = {}
): EngineStackItem {
    return {
        ...makeInstance(defId, {
            id: `o${Math.random().toString(36).slice(2)}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "stack",
        }),
        castById: "p1",
        ...extra,
    } as EngineStackItem;
}

/** Mint the key of one object as the client sees it. */
function keyOf(item: EngineStackItem): string {
    const state: GameState = makeState({
        stack: [item],
    } as Partial<GameState>);
    const [projected] = projectPublicState(state, 1, "p1")
        .stack as unknown as StackItem[];
    const key = yieldKeyForStackItem(projected);
    if (!key) throw new Error("fixture minted no key");
    return key;
}

const spellKey = keyOf(engineItem(BOLT.id));
const hydraPrevent = keyOf(
    engineItem(ROCK_HYDRA.id, { abilityId: "rock-hydra-prevent" })
);
const hydraGrow = keyOf(
    engineItem(ROCK_HYDRA.id, { abilityId: "rock-hydra-grow" })
);
const nobleExalted = keyOf(
    engineItem(NOBLE.id, {
        triggeredAbilityId: "exalted",
        triggerSourceId: "s",
    })
);
const ignobleExalted = keyOf(
    engineItem(IGNOBLE.id, {
        triggeredAbilityId: "exalted",
        triggerSourceId: "s",
    })
);
const farreliteDelayed = keyOf(
    engineItem(FARRELITE.id, { delayedTriggerId: "farrelite-priest-sacrifice" })
);
// CR 725 — the Monarch's end-step draw: card-less, keyed on its designation
// (`buildMonarchDrawStackItem`).
const monarchKey = keyOf(
    engineItem(BOLT.id, {
        card: { id: "" } as EngineStackItem["card"],
        delayedTriggerId: INLINE_DELAYED_TRIGGER_ID,
        designationId: MONARCH_DESIGNATION.id,
    })
);
// CR 114 — an emblem trigger's `card.id` is the emblem KEY
// (`buildEmblemTriggerItem`).
const emblemKey = keyOf(
    engineItem(BOLT.id, {
        card: {
            id: CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
        } as EngineStackItem["card"],
        triggeredAbilityId: "chandra-torch-of-defiance-emblem-cast",
        triggerSourceId: "emblem-1",
        emblemSourceId: CHANDRA_TORCH_OF_DEFIANCE_EMBLEM_ID,
    })
);

describe("Yield key parsing — the inverse of the minting (issue #3629)", () => {
    it("reads every kind back to its source and ability id", () => {
        expect(parseYieldKey(spellKey)).toEqual({
            kind: "spell",
            source: { type: "card", id: BOLT.id },
            abilityId: null,
        });
        expect(parseYieldKey(hydraGrow)).toEqual({
            kind: "activated",
            source: { type: "card", id: ROCK_HYDRA.id },
            abilityId: "rock-hydra-grow",
        });
        expect(parseYieldKey(monarchKey)).toEqual({
            kind: "delayed",
            source: { type: "designation", id: MONARCH_DESIGNATION.id },
            abilityId: INLINE_DELAYED_TRIGGER_ID,
        });
    });

    it("refuses what the minting could not have produced", () => {
        for (const junk of [
            "",
            "spell",
            "cast|card:x",
            "triggered|card:x",
            "spell|",
        ])
            expect(parseYieldKey(junk)).toBeNull();
    });
});

describe("Yield labels — every source kind, never a raw key (issue #3629)", () => {
    it("labels a spell by its card name", () => {
        expect(yieldKeyLabel(spellKey)).toEqual({
            source: "Lightning Bolt",
            kind: "cast",
            detail: null,
        });
    });

    it("labels an activated, a triggered and a delayed ability by card + kind + text", () => {
        expect(yieldKeyLabel(hydraGrow)).toMatchObject({
            source: "Rock Hydra",
            kind: "activated ability",
        });
        expect(yieldKeyLabel(nobleExalted)).toEqual({
            source: "Noble Hierarch",
            kind: "triggered ability",
            detail: "Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.",
        });
        expect(yieldKeyLabel(farreliteDelayed)).toMatchObject({
            source: "Farrelite Priest",
            kind: "delayed trigger",
        });
        expect(yieldKeyLabel(farreliteDelayed).detail).toBeTruthy();
    });

    it("labels a CR 725 designation trigger by the designation's name", () => {
        expect(yieldKeyLabel(monarchKey)).toMatchObject({
            source: "The Monarch",
            kind: "triggered ability",
        });
    });

    it("labels a CR 114 emblem trigger by the emblem's name", () => {
        expect(yieldKeyLabel(emblemKey)).toEqual({
            source: "Chandra, Torch of Defiance emblem",
            kind: "triggered ability",
            detail: "Whenever you cast a spell, this emblem deals 5 damage to any target.",
        });
    });

    it("never shows a key or a definition id in any row", () => {
        const keys = [
            spellKey,
            hydraPrevent,
            nobleExalted,
            farreliteDelayed,
            monarchKey,
            emblemKey,
        ];
        const ids = [BOLT.id, ROCK_HYDRA.id, NOBLE.id, FARRELITE.id];
        for (const row of yieldRows(keys)) {
            const text = `${row.title} ${row.detail ?? ""}`;
            expect(text).not.toContain("|");
            for (const id of ids) expect(text).not.toContain(id);
        }
    });

    it("tells two different abilities of the same card apart", () => {
        const [prevent, grow] = yieldRows([hydraPrevent, hydraGrow]);
        expect(`${prevent.title}\n${prevent.detail}`).not.toBe(
            `${grow.title}\n${grow.detail}`
        );
        expect(prevent.detail).toContain("Prevent the next 1 damage");
        expect(grow.detail).toContain("+1/+1 counter");
    });

    it("numbers two abilities of one card whose text does not resolve", () => {
        const a = keyOf(engineItem(ROCK_HYDRA.id, { abilityId: "unknown-a" }));
        const b = keyOf(engineItem(ROCK_HYDRA.id, { abilityId: "unknown-b" }));
        expect(yieldRows([a, b]).map((row) => row.title)).toEqual([
            "Rock Hydra — activated ability #1",
            "Rock Hydra — activated ability #2",
        ]);
    });
});

describe("Auto-order labels — source names in remembered order (issue #3629)", () => {
    it("lists the sources left to right, copies of one card repeated", () => {
        expect(
            triggerOrderSourceNames([
                nobleExalted,
                ignobleExalted,
                nobleExalted,
            ])
        ).toEqual(["Noble Hierarch", "Ignoble Hierarch", "Noble Hierarch"]);
    });
});
