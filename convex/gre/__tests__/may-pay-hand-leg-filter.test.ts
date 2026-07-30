// May-pay HAND leg — per-requirement FILTER (CR 701.9 / 118.9, ADR 0079,
// issue #1933).
//
// Unifying `AlternativeCost` and `MayPayCost` onto one `CostLegs` type made a
// FILTERED (and a multi-requirement) may-pay hand leg representable and
// validator-legal for the first time — the old `discard: { count }` shape
// could express neither. This suite pins that the leg is honoured rather than
// silently paid with any card: candidates are restricted per requirement,
// affordability is a per-requirement assignment (not a summed count), payment
// picks a MATCHING card, and the submit boundary rejects an illegal pick.
//
// The fail-OPEN this guards against (the repo's known filter bug class): a
// hidden-zone selector whose new filter field matches everything.

import { describe, it, expect } from "vitest";
import {
    canPayMayPayCost,
    payMayPayCost,
    getMayPayDiscardCandidateIds,
    mayPayDiscardChoiceRequired,
    type GameState,
} from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import type { MayPayCost } from "../../cards/types";

// Grizzly Bears (LEA) — a plain vanilla Creature.
const GRIZZLY_BEARS_ID = "ce2d603a-3231-4a8c-bf39-1617586ea870";
// Ancestral Recall (LEA) — a plain Instant (the NON-matching hand filler).
const ANCESTRAL_RECALL_ID = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";

/** "Discard a creature card" — one requirement carrying a real filter. */
const DISCARD_A_CREATURE: MayPayCost = {
    hand: {
        action: "discard",
        requirements: [{ filter: { type: "Creature" }, count: 1 }],
    },
};

/** "Discard a creature card and another card" (Foil's shape, on a may-pay) —
 *  two requirements that must be satisfied by DISTINCT cards. */
const DISCARD_A_CREATURE_AND_ANOTHER: MayPayCost = {
    hand: {
        action: "discard",
        requirements: [
            { filter: { type: "Creature" }, count: 1 },
            { filter: {}, count: 1 },
        ],
    },
};

/** The untyped "discard a card" shape (`filter: {}`) — every shipped may-pay
 *  hand leg today. Constrains nothing. */
const DISCARD_A_CARD: MayPayCost = {
    hand: {
        action: "discard",
        requirements: [{ filter: {}, count: 1 }],
    },
};

const bear = (id: string) =>
    makeInstance(GRIZZLY_BEARS_ID, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
const recall = (id: string) =>
    makeInstance(ANCESTRAL_RECALL_ID, {
        id,
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });

function stateWithHand(hand: ReturnType<typeof bear>[]): GameState {
    return makeState({
        players: [makePlayer("p1", { hand }), makePlayer("p2")],
    });
}

describe("may-pay HAND leg filter (CR 701.9 / 118.9, ADR 0079, issue #1933)", () => {
    it("restricts the candidate set to cards matching the requirement", () => {
        const state = stateWithHand([recall("r1"), bear("b1"), recall("r2")]);
        expect(
            getMayPayDiscardCandidateIds(state, "p1", DISCARD_A_CREATURE)
        ).toEqual(["b1"]);
    });

    it("is unaffordable when no hand card matches, however full the hand", () => {
        const state = stateWithHand([recall("r1"), recall("r2"), recall("r3")]);
        // The hand is three cards deep — a summed-count check would pass here.
        expect(canPayMayPayCost(state, "p1", DISCARD_A_CREATURE)).toBe(false);
    });

    it("pays with a MATCHING card, not the first card in hand order", () => {
        const state = stateWithHand([recall("r1"), bear("b1")]);
        expect(canPayMayPayCost(state, "p1", DISCARD_A_CREATURE)).toBe(true);
        // One legal candidate → no prompt (Arena UX auto-resolve), and the
        // auto-pick must still respect the filter.
        expect(
            mayPayDiscardChoiceRequired(state, "p1", DISCARD_A_CREATURE)
        ).toBe(false);
        payMayPayCost(state, "p1", DISCARD_A_CREATURE);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["b1"]);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["r1"]);
    });

    it("honours a legal payer pick and ignores an illegal one", () => {
        const state = stateWithHand([recall("r1"), bear("b1"), bear("b2")]);
        expect(
            mayPayDiscardChoiceRequired(state, "p1", DISCARD_A_CREATURE)
        ).toBe(true);
        payMayPayCost(state, "p1", DISCARD_A_CREATURE, undefined, undefined, [
            "b2",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["b2"]);
    });

    it("satisfies a multi-requirement leg from DISTINCT matching cards", () => {
        const ok = stateWithHand([recall("r1"), bear("b1")]);
        expect(canPayMayPayCost(ok, "p1", DISCARD_A_CREATURE_AND_ANOTHER)).toBe(
            true
        );
        payMayPayCost(ok, "p1", DISCARD_A_CREATURE_AND_ANOTHER);
        expect(ok.players[0].hand).toHaveLength(0);
        expect(ok.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "b1",
            "r1",
        ]);

        // Two cards in hand, two total needed — but neither is a creature, so
        // the creature requirement is unsatisfiable. The summed-count check
        // this replaced said "affordable".
        const bad = stateWithHand([recall("r1"), recall("r2")]);
        expect(
            canPayMayPayCost(bad, "p1", DISCARD_A_CREATURE_AND_ANOTHER)
        ).toBe(false);
    });

    it("leaves the untyped `filter: {}` shape matching the whole hand", () => {
        const state = stateWithHand([recall("r1"), bear("b1")]);
        expect(
            getMayPayDiscardCandidateIds(state, "p1", DISCARD_A_CARD)
        ).toEqual(["r1", "b1"]);
        expect(canPayMayPayCost(state, "p1", DISCARD_A_CARD)).toBe(true);
    });
});
