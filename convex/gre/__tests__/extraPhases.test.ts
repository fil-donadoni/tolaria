// Extra phases (CR 500.8) — the queue, the consumption seam and the
// turn-boundary discard (issue #2886, ADR 0111).
//
// CR 500.8, printed from the vendored document: "Some effects can add phases
// to a turn. They do this by adding the phases directly after the specified
// phase. If multiple extra phases are created after the same phase, the most
// recently created phase will occur first."
//
// The ORDERING clause is asserted on the QUEUE, never through observed phase
// order: with one phase kind in the vocabulary two entries are
// indistinguishable, so LIFO and FIFO produce identical phase sequences and a
// phase-order test would pass either way (ADR 0111 decision 4). Object
// IDENTITY is what makes the pop side observable.

import { describe, it, expect } from "vitest";
import { advancePhase } from "../phases";
import type { GameState, ExtraPhase } from "../state";
import type { Phase } from "../types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { batteringRam } from "../../cards/sets/atq/colorless";

/** Walk `advancePhase` until `stop` is reached, returning every phase entered.
 *  Capped so a malformed position fails loudly instead of hanging. */
function walkPhasesUntil(
    state: GameState,
    stop: (s: GameState) => boolean,
    cap = 40
): Phase[] {
    const seen: Phase[] = [];
    for (let i = 0; i < cap; i++) {
        advancePhase(state);
        seen.push(state.phase);
        if (stop(state)) return seen;
    }
    throw new Error(
        `walkPhasesUntil: never reached the stop condition (ended at ${state.phase} after ${cap} advances): ${seen.join(" -> ")}`
    );
}

describe("extra phases (CR 500.8)", () => {
    describe("the consumption seam at the END_OF_COMBAT exit", () => {
        it("re-enters BEGINNING_OF_COMBAT instead of leaving combat (CR 506.1)", () => {
            const state = makeState({
                phase: "END_OF_COMBAT",
                extraPhases: [{ kind: "combat" }],
            });
            advancePhase(state);
            // CR 506.1 — a combat phase is five steps, so the added phase
            // re-enters at its FIRST step, not at declare-attackers.
            expect(state.phase).toBe("BEGINNING_OF_COMBAT");
            expect(state.extraPhases).toBeUndefined();
            expect(state.extraCombatsThisTurn).toBe(1);
        });

        it("leaves combat normally when nothing is queued", () => {
            const state = makeState({ phase: "END_OF_COMBAT" });
            advancePhase(state);
            expect(state.phase).toBe("POSTCOMBAT_MAIN");
            expect(state.extraCombatsThisTurn).toBeUndefined();
        });

        it("pops LIFO — the most recently created entry occurs first", () => {
            // Two entries are VALUE-identical (one phase kind ships), so the
            // assertion is on object identity: `second` is the one consumed,
            // `first` is the one left behind. A FIFO pop leaves `second`.
            const first: ExtraPhase = { kind: "combat" };
            const second: ExtraPhase = { kind: "combat" };
            const state = makeState({
                phase: "END_OF_COMBAT",
                extraPhases: [first, second],
            });
            advancePhase(state);
            expect(state.extraPhases).toHaveLength(1);
            expect(state.extraPhases![0]).toBe(first);
            expect(state.extraPhases![0]).not.toBe(second);
        });

        it("only the END_OF_COMBAT exit consumes the queue", () => {
            const state = makeState({
                phase: "PRECOMBAT_MAIN",
                extraPhases: [{ kind: "combat" }],
            });
            advancePhase(state);
            expect(state.phase).toBe("BEGINNING_OF_COMBAT");
            expect(state.extraPhases).toEqual([{ kind: "combat" }]);
            expect(state.extraCombatsThisTurn).toBeUndefined();
        });
    });

    describe("playing the additional phase out", () => {
        it("plays two extra combats, then continues to the postcombat main phase", () => {
            const state = makeState({
                phase: "END_OF_COMBAT",
                extraPhases: [{ kind: "combat" }, { kind: "combat" }],
            });
            const seen = walkPhasesUntil(
                state,
                (s) => s.phase === "POSTCOMBAT_MAIN"
            );
            expect(
                seen.filter((p) => p === "BEGINNING_OF_COMBAT")
            ).toHaveLength(2);
            expect(seen.filter((p) => p === "DECLARE_ATTACKERS")).toHaveLength(
                2
            );
            expect(seen[seen.length - 1]).toBe("POSTCOMBAT_MAIN");
            expect(state.extraPhases).toBeUndefined();
            expect(state.extraCombatsThisTurn).toBe(2);
        });

        it("fires 'at the beginning of combat' triggers again (CR 603.6a)", () => {
            // Battering Ram (ATQ): "At the beginning of combat on your turn,
            // this creature gains banding until end of combat." Its trigger is
            // the observable proof that `performPhaseEntry` /
            // `firePhaseBeginTriggers` run for the added phase rather than
            // being skipped as already-done this turn.
            const ram = makeInstance(batteringRam.id, {
                id: "ram",
                controllerId: "p1",
            });
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: [ram] }),
                    makePlayer("p2"),
                ],
                phase: "END_OF_COMBAT",
                activePlayerId: "p1",
                extraPhases: [{ kind: "combat" }],
            });
            expect(state.stack).toHaveLength(0);
            advancePhase(state);
            expect(state.phase).toBe("BEGINNING_OF_COMBAT");
            expect(state.stack).toHaveLength(1);
        });
    });

    describe("the turn boundary", () => {
        it("discards an unconsumed entry rather than leaking it into the opponent's turn", () => {
            const state = makeState({
                phase: "CLEANUP",
                activePlayerId: "p1",
                extraPhases: [{ kind: "combat" }],
                extraCombatsThisTurn: 1,
            });
            advancePhase(state);
            expect(state.activePlayerId).toBe("p2");
            expect(state.extraPhases).toBeUndefined();
            expect(state.extraCombatsThisTurn).toBeUndefined();

            // And the opponent's turn plays exactly ONE combat phase.
            const seen = walkPhasesUntil(
                state,
                (s) => s.phase === "POSTCOMBAT_MAIN"
            );
            expect(
                seen.filter((p) => p === "BEGINNING_OF_COMBAT")
            ).toHaveLength(1);
        });
    });
});
