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
    mayPayHandAutoSelection,
    mayPayHandSelectionLegal,
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
// Forest (LEA) — a basic Land, for the "restrictive requirement declared last"
// ordering probe.
const FOREST_ID = "6f1c8cb0-38eb-408b-94e8-16db83999b3b";

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

/** "Discard a card, then a Land card" — the SAME two requirements as
 *  {@link DISCARD_A_LAND_AND_ANOTHER} but declared restrictive-LAST. The greedy
 *  assignment is declaration-ordered (deliberate parity with the alternative-cost
 *  hand leg, `canPayHandCost`), so this ordering is the documented authoring
 *  hazard `CostLegs.hand` warns about — kept here as the click-order probe. */
const DISCARD_A_CARD_THEN_A_LAND: MayPayCost = {
    hand: {
        action: "discard",
        requirements: [
            { filter: {}, count: 1 },
            { filter: { type: "Land" }, count: 1 },
        ],
    },
};

/** Foil's shape: "discard a Land card and another card" — restrictive FIRST,
 *  the ordering the authoring constraint mandates. */
const DISCARD_A_LAND_AND_ANOTHER: MayPayCost = {
    hand: {
        action: "discard",
        requirements: [
            { filter: { type: "Land" }, count: 1 },
            { filter: {}, count: 1 },
        ],
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
const forest = (id: string) =>
    makeInstance(FOREST_ID, {
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
        // A LEGAL pick is accepted at the submit boundary and paid verbatim.
        expect(
            mayPayHandSelectionLegal(state, "p1", DISCARD_A_CREATURE, ["b2"])
        ).toBe(true);
        payMayPayCost(state, "p1", DISCARD_A_CREATURE, undefined, undefined, [
            "b2",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["b2"]);

        // An ILLEGAL pick — Ancestral Recall is no Creature — is REJECTED at
        // the submit boundary, so it never reaches the pay path…
        const illegal = stateWithHand([recall("r1"), bear("b1"), bear("b2")]);
        expect(
            mayPayHandSelectionLegal(illegal, "p1", DISCARD_A_CREATURE, ["r1"])
        ).toBe(false);
        // …and should one arrive anyway (a non-boundary caller), the greedy
        // quietly ignores the unusable preference and still pays a MATCHING
        // card rather than paying nothing.
        payMayPayCost(illegal, "p1", DISCARD_A_CREATURE, undefined, undefined, [
            "r1",
        ]);
        expect(illegal.players[0].graveyard.map((c) => c.id)).toEqual(["b1"]);
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

// PR #1963 review round 2 — the submit boundary and the pay path used to run
// DIFFERENT assignments: the boundary assigned over the picked subset in HAND
// order, the pay path over the whole hand in the client's CLICK order. A pick
// legal one way and not the other passed the boundary and then discarded
// NOTHING while the cost still counted as paid.
describe("may-pay HAND leg — one assignment authority (CR 701.9 / 118.9, PR #1963)", () => {
    it("rejects a click-ORDER pick the pay path could not honour", () => {
        const state = stateWithHand([bear("b1"), forest("f1")]);
        // Both cards are candidates (the untyped requirement admits either) and
        // the count is right, so every count-based check says "legal".
        expect(
            getMayPayDiscardCandidateIds(
                state,
                "p1",
                DISCARD_A_CARD_THEN_A_LAND
            ).sort()
        ).toEqual(["b1", "f1"]);

        // Clicked Forest FIRST: the greedy spends it on the untyped
        // requirement and the Land requirement is then unsatisfiable.
        expect(
            mayPayHandSelectionLegal(state, "p1", DISCARD_A_CARD_THEN_A_LAND, [
                "f1",
                "b1",
            ])
        ).toBe(false);
        // Clicked Bear first: the same two cards cover both requirements.
        expect(
            mayPayHandSelectionLegal(state, "p1", DISCARD_A_CARD_THEN_A_LAND, [
                "b1",
                "f1",
            ])
        ).toBe(true);
    });

    it("THROWS rather than silently paying nothing when the assignment fails", () => {
        const state = stateWithHand([bear("b1"), forest("f1")]);
        expect(() =>
            payMayPayCost(
                state,
                "p1",
                DISCARD_A_CARD_THEN_A_LAND,
                undefined,
                undefined,
                ["f1", "b1"]
            )
        ).toThrow(/hand cost/i);
        // The free lunch: the old `?? []` discarded NOTHING here while the
        // cost still counted as paid.
        expect(state.players[0].graveyard).toHaveLength(0);
    });

    it("pays exactly the set the submit boundary accepted", () => {
        const state = stateWithHand([bear("b1"), forest("f1")]);
        const ids = ["b1", "f1"];
        expect(
            mayPayHandSelectionLegal(
                state,
                "p1",
                DISCARD_A_CARD_THEN_A_LAND,
                ids
            )
        ).toBe(true);
        payMayPayCost(
            state,
            "p1",
            DISCARD_A_CARD_THEN_A_LAND,
            undefined,
            undefined,
            ids
        );
        expect(state.players[0].graveyard.map((c) => c.id).sort()).toEqual([
            "b1",
            "f1",
        ]);
        expect(state.players[0].hand).toHaveLength(0);
    });

    it("is click-order INSENSITIVE when the restrictive requirement is declared first", () => {
        // The authoring constraint documented on `CostLegs.hand`: Foil's
        // ordering makes every click order legal, because the restrictive
        // requirement claims its card before the permissive one can take it.
        const state = stateWithHand([bear("b1"), forest("f1")]);
        for (const ids of [
            ["b1", "f1"],
            ["f1", "b1"],
        ]) {
            expect(
                mayPayHandSelectionLegal(
                    state,
                    "p1",
                    DISCARD_A_LAND_AND_ANOTHER,
                    ids
                )
            ).toBe(true);
        }
    });
});

describe("mayPayHandAutoSelection (CR 701.9 / 118.9, PR #1963)", () => {
    it("returns [] for a cost with no hand leg", () => {
        const state = stateWithHand([bear("b1")]);
        expect(mayPayHandAutoSelection(state, "p1", { R: 1 })).toEqual([]);
    });

    it("falls back to HAND order with no preference", () => {
        const state = stateWithHand([bear("b1"), bear("b2")]);
        expect(
            mayPayHandAutoSelection(state, "p1", DISCARD_A_CREATURE)
        ).toEqual(["b1"]);
    });

    it("honours a legal preference ordering", () => {
        const state = stateWithHand([bear("b1"), bear("b2")]);
        expect(
            mayPayHandAutoSelection(state, "p1", DISCARD_A_CREATURE, [
                "b2",
                "b1",
            ])
        ).toEqual(["b2"]);
    });

    it("ignores a preference the FILTER cannot use", () => {
        const state = stateWithHand([recall("r1"), bear("b1")]);
        expect(
            mayPayHandAutoSelection(state, "p1", DISCARD_A_CREATURE, ["r1"])
        ).toEqual(["b1"]);
    });

    it("returns [] when the leg cannot be covered at all", () => {
        const state = stateWithHand([recall("r1"), recall("r2")]);
        expect(
            mayPayHandAutoSelection(state, "p1", DISCARD_A_CREATURE)
        ).toEqual([]);
    });

    it("returns a set the submit boundary accepts (the two agree)", () => {
        const state = stateWithHand([bear("b1"), forest("f1")]);
        // Worst-first preference puts the Land first — the ordering the bot
        // would supply, and the one that breaks the permissive-first leg.
        const chosen = mayPayHandAutoSelection(
            state,
            "p1",
            DISCARD_A_LAND_AND_ANOTHER,
            ["f1", "b1"]
        );
        expect(chosen.sort()).toEqual(["b1", "f1"]);
        expect(
            mayPayHandSelectionLegal(
                state,
                "p1",
                DISCARD_A_LAND_AND_ANOTHER,
                chosen
            )
        ).toBe(true);
    });
});
