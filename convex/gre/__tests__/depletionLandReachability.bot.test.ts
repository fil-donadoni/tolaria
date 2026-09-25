// Bot reachability for the depletion lands — issue #2712.
//
// A depletion land is the first shipped mana source whose cost carries a FIXED
// `removeCounter` leg, and the whole point of the card is that its two mana
// come out of ONE tap. Two ways that can be invisible to the bot, neither of
// which fails any other suite:
//
//  * the planner never funds the cast at all — `isAutoPayableManaAbilityCost`
//    admits the ability on its `cost.tap` leg and nothing else, so a leg it
//    refused would make the land pure decoration in every simulated future;
//  * the planner funds it from a land that cannot actually pay — a depletion
//    land stripped of its counters (Vampire Hexmage, Thief of Blood) sits on
//    the battlefield producing nothing, and a plan that taps it produces a
//    Move the real mutation rejects.
//
// `enumerateMoves` is the seam, so it is what this asserts. The leaf
// heuristic's mana census is not the mechanism that decides whether a cast is
// offered — and since issue #3531 it is no longer a scalar proxy at all:
// `availableManaFor` is gone, and `manaUnitsFor` (`gre/manaAvailability.ts`)
// counts one colour unit per mana a source actually taps for, which retired
// issue #2247's one-per-source asymmetry along with it.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, planManaPayment } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { hickoryWoodlot } from "../../cards/sets/mmq/colorless";
import type { CardInstanceState, GameState, PlayerState } from "../state";

const BEARS = getCardByName("Grizzly Bears").id; // {1}{G}, 2/2

/** p1's main phase with ONE untapped Hickory Woodlot carrying `counters`
 *  depletion counters, Grizzly Bears in hand, and no other mana source. */
function board(counters: number): {
    state: GameState;
    player: PlayerState;
    woodlot: CardInstanceState;
} {
    const woodlot = makeInstance(hickoryWoodlot.id, {
        id: "woodlot",
        controllerId: "p1",
        ownerId: "p1",
        ...(counters > 0 ? { counters: { depletion: counters } } : {}),
    });
    const bears = makeInstance(BEARS, {
        id: "bears",
        controllerId: "p1",
        ownerId: "p1",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [woodlot], hand: [bears] }),
            makePlayer("p2"),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    return {
        state,
        player: state.players[0]!,
        woodlot: state.players[0]!.battlefield[0]!,
    };
}

describe("depletion lands — bot reachability (issue #2712)", () => {
    it("a Hickory Woodlot with counters funds a two-mana cast from a single tap", () => {
        const { state, player } = board(2);

        const casts = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "bears"
        );

        expect(casts.length).toBeGreaterThan(0);
        const cast = casts[0]!;
        if (cast.kind !== "cast-spell") throw new Error("filtered above");
        // The plan is ONE tap, not two sources: {G}{G} out of one land. Before
        // `removeCounter` joined `TAP_YIELD_CREDITABLE_COST_LEGS` the land
        // credited ONE mana, this returned null, and the bot held the Bears.
        const plan = planManaPayment(state, player, { X: 1, G: 1 });
        expect(plan).toEqual([{ cardInstanceId: "woodlot" }]);
        expect(cast.tapPlan).toEqual([{ cardInstanceId: "woodlot" }]);
    });

    it("a Hickory Woodlot stripped of its counters funds nothing", () => {
        const { state, player } = board(0);

        const casts = enumerateMoves(state, "p1").filter(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "bears"
        );

        expect(casts).toEqual([]);
        expect(planManaPayment(state, player, { X: 1, G: 1 })).toBeNull();
    });
});

describe("depletion lands — the search's coarse mana model (issue #2712)", () => {
    // `applyTapPlanInSearch` (`searchTapPlan.ts`, issue #4444) is the whole
    // model of "what tapping for mana does" INSIDE the tree. It marks sources
    // tapped and, since #3027, moves a self-sacrificing one to the graveyard.
    // It did not touch counters, so a depletion land came out of every
    // simulated tap with both of them: it untaps next simulated turn, taps
    // again, and never dies — the search values a two-use land as a permanent
    // mana source. Nothing else reds on that; it just makes the bot plan around
    // mana it does not have.
    it("spends a counter when the plan taps the land", () => {
        const { state } = board(2);
        const cast = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "bears"
        )!;

        const next = applyMoveForSearch(state, "p1", cast);

        const land = next.players[0]!.battlefield.find(
            (c) => c.id === "woodlot"
        )!;
        expect(land.isTapped).toBe(true);
        expect(land.counters?.depletion).toBe(1);
    });

    it("moves the land to the graveyard when the plan spends its LAST counter", () => {
        const { state } = board(1);
        const cast = enumerateMoves(state, "p1").find(
            (m) => m.kind === "cast-spell" && m.cardInstanceId === "bears"
        )!;

        const next = applyMoveForSearch(state, "p1", cast);

        expect(
            next.players[0]!.battlefield.find((c) => c.id === "woodlot")
        ).toBeUndefined();
        expect(
            next.players[0]!.graveyard.find((c) => c.id === "woodlot")
        ).toBeDefined();
    });
});
