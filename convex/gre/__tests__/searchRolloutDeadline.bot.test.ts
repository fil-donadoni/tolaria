// `RolloutDeadline` (issue #10408): the search's wall-clock cap, read by the
// rollout once per ply. The search loop reads its clock only BETWEEN
// iterations, so before this the iteration in flight when the cap passed ran
// to its end — on a slow client longer than the consult timeout's whole
// overrun margin. A rollout that finds the cap passed scores the position it
// reached, and the search overshoots by one ply instead of one iteration.
import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import type { ScenarioSpec } from "../../debugScenarioSpec";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { makeRng } from "../rng";
import { rollout, searchWithTrace, type RolloutDeadline } from "../search";

const SPEC: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Lightning Bolt", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

function position() {
    const state = buildBladeState({
        label: "rollout deadline fixture",
        spec: SPEC,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    return { state, seat: state.players[0].id };
}

describe("rollout — the search's wall-clock cap (issue #10408)", () => {
    it("a passed cap stops the playout where it stands", () => {
        const { state, seat } = position();
        const deadline: RolloutDeadline = { now: () => 10, at: 5, cut: false };
        const turn = state.turn;
        const phase = state.phase;
        rollout(
            state,
            seat,
            makeRng(7),
            DEFAULT_EVAL_WEIGHTS,
            undefined,
            deadline
        );
        expect(deadline.cut).toBe(true);
        expect(state.turn).toBe(turn);
        expect(state.phase).toBe(phase);
    });

    it("an unreached cap leaves the playout and its stream untouched", () => {
        const plain = position();
        const timed = position();
        const deadline: RolloutDeadline = {
            now: () => 0,
            at: 60_000,
            cut: false,
        };
        const a = rollout(
            plain.state,
            plain.seat,
            makeRng(7),
            DEFAULT_EVAL_WEIGHTS
        );
        const b = rollout(
            timed.state,
            timed.seat,
            makeRng(7),
            DEFAULT_EVAL_WEIGHTS,
            undefined,
            deadline
        );
        expect(deadline.cut).toBe(false);
        expect(b).toEqual(a);
        expect(timed.state.turn).toBe(plain.state.turn);
        expect(timed.state.turn).toBeGreaterThan(position().state.turn);
    });

    it("an untimed search builds no deadline: the trace never reports a cut", () => {
        const { state, seat } = position();
        const r = searchWithTrace(state, seat, { iterations: 30 }, 7);
        expect(r.trace?.rolloutCutByClock).toBeUndefined();
    });
});
