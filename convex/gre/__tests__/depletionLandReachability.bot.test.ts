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
// `enumerateMoves` is the seam, so it is what this asserts — the coarse
// `availableManaFor` proxy in `evaluate.ts` deliberately counts any untapped
// source as ONE mana (issue #2247's documented divergence) and is not the
// mechanism that decides whether a cast is offered.

import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { enumerateMoves, planManaPayment } from "../moves";
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
