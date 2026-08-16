// SURFACE test for the CR 514.3a cleanup priority window (issue #2472).
//
// CR 514.3: "Normally, no player receives priority during the cleanup step, so
// no spells can be cast and no abilities can be activated. However, this rule
// is subject to the following exception:"
// CR 514.3a: "…those triggered abilities are put on the stack, then the active
// player gets priority. Players may cast spells and activate abilities. Once
// the stack is empty and all players pass in succession, another cleanup step
// begins."
//
// The engine opening that window is only half the mechanic: the client's own
// reducers decide whether a Pass affordance renders at all, and `src/lib/
// priority.ts` used to list CLEANUP unconditionally among the no-priority
// phases — so `computeHasPriority` returned false for the player the server
// had just handed priority to, `useControllerActions` filtered the Pass action
// out and Space early-returned, deadlocking the board with the cleanup trigger
// on the stack.
//
// This drives the assertion through BOTH real reducers — `projectPublicState`
// (server → wire) and `computeHasPriority` / `computePriorityState` — off a
// state produced by the REAL `advancePhase`. A hand-built ctx would mask
// exactly the two drops it exists to catch: the wire projection losing the
// flag, and the reducer ignoring it.
import { describe, it, expect } from "vitest";
import {
    computeHasPriority,
    computePriorityState,
    computeSoloViewerId,
    type HasPriorityCtx,
} from "~/lib/priority";
import { projectPublicState } from "@convex/gameProjections";
import { advancePhase } from "@convex/gre/phases";
import { resolveTopOfStack, type GameState } from "@convex/gre/state";
import { makePlayer, makeState } from "@convex/cards/__tests__/setup";
import { cloakOfConfusion } from "@convex/cards/sets/ice/black";

/** A game at END_STEP with a `next-cleanup-step` delayed trigger armed, so the
 *  very next `advancePhase` runs the real CR 514.1/514.2/514.3a sequence. */
function stateWithCleanupTrigger(): GameState {
    const state = makeState({
        phase: "END_STEP",
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1"), makePlayer("p2")],
    });
    state.delayedTriggers = [
        {
            id: "dt-cleanup-surface",
            sourceCardId: cloakOfConfusion.id,
            triggerId: "$inline-effects",
            controller: "p1",
            timing: "next-cleanup-step",
            payload: {},
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
            oracleText:
                "At the beginning of the next cleanup step, you gain 1 life.",
        },
    ];
    return state;
}

/** The ctx the board builds for `computeHasPriority` (`useControllerActions`)
 *  — read off the PROJECTED state, never the raw engine state, so a field the
 *  wire drops fails this test instead of passing it. */
function ctxFromWire(
    projected: ReturnType<typeof projectPublicState>,
    playerId: string
): HasPriorityCtx {
    return {
        playerId,
        activePlayerId: projected.activePlayerId,
        priorityPlayerId: projected.priorityPlayerId,
        phase: projected.phase,
        pendingCast: projected.pendingCast,
        pendingActivation: projected.pendingActivation,
        pendingTarget: projected.pendingTarget,
        combat: projected.combat,
        meleeCombat: projected.meleeCombat,
        pendingExtraCleanupStep: projected.pendingExtraCleanupStep,
    };
}

describe("cleanup priority window on the client (CR 514.3a)", () => {
    it("grants the active player priority in CLEANUP through the wire and the reducers", () => {
        const state = stateWithCleanupTrigger();
        advancePhase(state);

        // Precondition: the engine really did open the window.
        expect(state.phase).toBe("CLEANUP");
        expect(state.stack.length).toBe(1);
        expect(state.priorityPlayerId).toBe("p1");

        const projected = projectPublicState(state, 1, "p1");
        // The flag must survive the projection — it is what the reducer reads.
        expect(projected.pendingExtraCleanupStep).toBe(true);
        expect(projected.phase).toBe("CLEANUP");

        expect(computeHasPriority(ctxFromWire(projected, "p1"))).toBe(true);
        expect(computePriorityState(ctxFromWire(projected, "p1"))).toBe("mine");

        // The opponent is told it is not on them, not that nobody is acting.
        const p2Projected = projectPublicState(state, 1, "p2");
        expect(computeHasPriority(ctxFromWire(p2Projected, "p2"))).toBe(false);
        expect(computePriorityState(ctxFromWire(p2Projected, "p2"))).toBe(
            "opponent"
        );

        // Solo mode follows priority into the cleanup window (shared selector).
        expect(
            computeSoloViewerId({
                activePlayerId: projected.activePlayerId,
                priorityPlayerId: projected.priorityPlayerId,
                phase: projected.phase,
                playerIds: projected.players.map((p) => p.id),
            })
        ).toBe("p1");
    });

    it("goes back to a no-priority cleanup step once the window closes (CR 514.3)", () => {
        const state = stateWithCleanupTrigger();
        advancePhase(state);
        resolveTopOfStack(state);
        // Both players pass with an empty stack → the additional cleanup step
        // runs and, with nothing new triggering, the turn ends.
        advancePhase(state);

        expect(state.turn).toBe(2);
        expect(state.pendingExtraCleanupStep).toBeUndefined();

        // A plain CLEANUP with no open window must still read as no-priority,
        // or the client would offer a Pass button during every turn's cleanup.
        const quietCleanup = projectPublicState(
            { ...state, phase: "CLEANUP" },
            1,
            "p1"
        );
        expect(computeHasPriority(ctxFromWire(quietCleanup, "p1"))).toBe(false);
        expect(computePriorityState(ctxFromWire(quietCleanup, "p1"))).toBe(
            "none"
        );
    });
});
