// A self-sacrifice activation cost that eats the ability's OWN TARGET
// (CR 601.2c / 601.2h / 602.2b / 608.2b, issue #3424).
//
// This file pins the ENGINE half as correct rather than changing it. The order
// the CR fixes is what makes the shape possible at all: an activated ability
// goes on the stack (CR 602.2a) and then follows the CR 601.2b-i steps, where
// TARGETS are chosen at CR 601.2c and COSTS are paid last, at CR 601.2h. So
// naming the source of a "Sacrifice this permanent:" ability as its own target
// is a legal announcement, and by the time the ability would resolve its only
// target is in the graveyard — an illegal target, and with no legal target
// left the ability is countered on resolution (CR 608.2b) without doing
// anything at all.
//
// The bot's side of this — never CHOOSING that announcement — is the dominance
// prune in `gre/ai/dominance.ts` and its tests in
// `gre/ai/__tests__/dominance.bot.test.ts`. Nothing here may be "fixed" to make
// the bot's job easier: a human may always name that target, and the engine
// must keep letting them.

import { describe, it, expect } from "vitest";
import type { GameState, PendingTarget } from "../state";
import { resolveTopOfStack } from "../state";
import { finalizeTargetSelection } from "../../game";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

const ABILITY_ID = "seal-of-cleansing-sac";

/** p1 holds the Seal; p2 holds an artifact the Seal could legally have hit. */
function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance("af6c921e-1b82-412c-9979-adfdf83440f7", {
                        id: "seal",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                    // A SECOND legal target the announcement did not name. It
                    // is what makes "the ability was countered" distinguishable
                    // from "the ability resolved and found nothing to do": a
                    // resolution that re-chose a legal target (the CR 608.2b
                    // violation) would take this one.
                    makeInstance("af6c921e-1b82-412c-9979-adfdf83440f7", {
                        id: "bystander",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance("cac8c421-5b92-481d-b2de-560c0231ab58", {
                        id: "tome",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

/** Announce the ability against `targetId` through the REAL commit path. */
function announce(state: GameState, targetId: string): void {
    const pt: PendingTarget = {
        playerId: "p1",
        cardInstanceId: "seal",
        kind: "ability",
        abilityId: ABILITY_ID,
        targetType: ["Artifact", "Enchantment"],
        count: 1,
        selected: [{ type: "permanent", id: targetId }],
    };
    finalizeTargetSelection(state, pt, "p1");
}

describe("self-sacrifice cost eating its own target (CR 608.2b, issue #3424)", () => {
    it("accepts the announcement and pays the cost, source and all", () => {
        const state = board();
        announce(state, "seal");
        // CR 601.2h — the cost is paid as the ability commits, so the source is
        // already in the graveyard while the ability sits on the stack.
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "bystander",
        ]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["seal"]);
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].abilityId).toBe(ABILITY_ID);
    });

    it("counters the ability on resolution and touches nothing", () => {
        const state = board();
        announce(state, "seal");
        resolveTopOfStack(state);
        // CR 608.2b — no legal target left, so the ability does not resolve.
        expect(state.stack).toHaveLength(0);
        // The opponent's artifact was never in danger: the announcement could
        // only ever have destroyed the target it named.
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual(["tome"]);
        // The other legal target was never in danger either: a countered
        // ability does not go looking for a replacement (CR 608.2b).
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "bystander",
        ]);
        // And the permanent is spent for nothing — the whole point of the bug.
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["seal"]);
    });

    it("CONTROL: aimed at the opponent's artifact it destroys it", () => {
        const state = board();
        announce(state, "tome");
        resolveTopOfStack(state);
        expect(state.stack).toHaveLength(0);
        expect(state.players[1].battlefield).toHaveLength(0);
        expect(state.players[1].graveyard.map((c) => c.id)).toEqual(["tome"]);
        expect(state.players[0].graveyard.map((c) => c.id)).toEqual(["seal"]);
        expect(state.players[0].battlefield.map((c) => c.id)).toEqual([
            "bystander",
        ]);
    });
});
