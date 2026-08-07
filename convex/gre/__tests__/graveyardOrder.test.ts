// CR 404.3 — the graveyard is an ORDERED zone, and this engine encodes that
// order as INSERTION order in `PlayerState.graveyard`: index 0 is the OLDEST
// card (the bottom of the pile), the LAST index is the most recently added
// one (the TOP). Every insertion site APPENDS.
//
// Until issue #1967 that order was write-only — nothing in the engine ever
// READ it, so a site that prepended instead of appending would have been
// silently wrong forever. The deterministic top-of-graveyard selector
// (`EffectZonePositionSelector`, Shallow Grave / Corpse Dance) now depends on
// it, so this file pins the guarantee at the two funnels every graveyard
// insertion routes through:
//
//   - `removePermanentTo` (`gre/state.ts`) — EVERY battlefield departure
//     (death, sacrifice, destruction, bounce);
//   - `moveCard` (`gre/state.ts`) — the universal non-battlefield zone mover
//     (`discardToGraveyard`, `SpellContext.moveZone`/`moveCardById`, mill).
//
// The interleaving test is the one that matters most: a graveyard that
// collects cards through BOTH funnels must still read back in one coherent
// chronological order.

import { describe, it, expect } from "vitest";
import {
    moveCard,
    removePermanentTo,
    discardToGraveyard,
    getPlayer,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { grizzlyBears } from "../../cards/sets/lea";

/** The card ids in `p1`'s graveyard, bottom (oldest) → top (newest). */
const pileOf = (state: ReturnType<typeof makeState>) =>
    getPlayer(state, "p1").graveyard.map((c) => c.id);

describe("graveyard order (CR 404.3 — an ordered zone; top = last element)", () => {
    it("removePermanentTo APPENDS: two creatures dying in sequence land oldest-first, newest on top", () => {
        const first = makeInstance(grizzlyBears.id, {
            id: "died-first",
            controllerId: "p1",
            ownerId: "p1",
        });
        const second = makeInstance(grizzlyBears.id, {
            id: "died-second",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [first, second] }),
                makePlayer("p2"),
            ],
        });

        removePermanentTo(state, "died-first", "graveyard", "destroy");
        expect(pileOf(state)).toEqual(["died-first"]);

        removePermanentTo(state, "died-second", "graveyard", "destroy");
        // The SECOND death is on TOP — the last array element, not the first.
        expect(pileOf(state)).toEqual(["died-first", "died-second"]);
    });

    it("moveCard APPENDS: two discards land oldest-first, newest on top", () => {
        const first = makeInstance(grizzlyBears.id, {
            id: "discarded-first",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const second = makeInstance(grizzlyBears.id, {
            id: "discarded-second",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { hand: [first, second] }),
                makePlayer("p2"),
            ],
        });

        discardToGraveyard(state, "p1", "discarded-first");
        discardToGraveyard(state, "p1", "discarded-second");

        expect(pileOf(state)).toEqual(["discarded-first", "discarded-second"]);
    });

    it("moveCard APPENDS for a library → graveyard move (mill) too", () => {
        const top = makeInstance(grizzlyBears.id, {
            id: "milled-first",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const next = makeInstance(grizzlyBears.id, {
            id: "milled-second",
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    library: [top, next],
                    graveyard: [
                        makeInstance(grizzlyBears.id, {
                            id: "already-there",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "graveyard",
                        }),
                    ],
                }),
                makePlayer("p2"),
            ],
        });

        const p1 = getPlayer(state, "p1");
        moveCard(p1, "milled-first", "library", "graveyard");
        moveCard(p1, "milled-second", "library", "graveyard");

        // The pre-existing card stays at the BOTTOM; the milled cards stack
        // on top of it in mill order.
        expect(pileOf(state)).toEqual([
            "already-there",
            "milled-first",
            "milled-second",
        ]);
    });

    it("the two funnels interleave into ONE chronological order", () => {
        const creature = makeInstance(grizzlyBears.id, {
            id: "the-creature",
            controllerId: "p1",
            ownerId: "p1",
        });
        const inHand = makeInstance(grizzlyBears.id, {
            id: "the-discard",
            controllerId: "p1",
            ownerId: "p1",
            zone: "hand",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [creature],
                    hand: [inHand],
                }),
                makePlayer("p2"),
            ],
        });

        // Discard first (moveCard funnel), then the creature dies
        // (removePermanentTo funnel). The creature must end up on TOP.
        discardToGraveyard(state, "p1", "the-discard");
        removePermanentTo(state, "the-creature", "graveyard", "destroy");

        expect(pileOf(state)).toEqual(["the-discard", "the-creature"]);
        // "Top of the graveyard" is the LAST element — the property the
        // positional selector reads (issue #1967).
        const pile = getPlayer(state, "p1").graveyard;
        expect(pile[pile.length - 1].id).toBe("the-creature");
        expect(pile[0].id).toBe("the-discard");
    });
});
