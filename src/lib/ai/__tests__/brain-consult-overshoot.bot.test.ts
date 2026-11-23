// A search iteration longer than the consult's overrun margin (issue #10408).
//
// `BRAIN_CONSULT_TIMEOUT_MS` is the hardest cap plus an overrun margin plus a
// transport margin. The margin used to have to cover ONE WHOLE ITERATION —
// the search read its clock only between iterations — and a Gecko iteration
// in the field took 1,658 ms at p90 and 3,567 ms for the first one, against a
// 1,500 ms margin (`docs/research/bot-weak-line-weak-client.md` § 4). Such a
// consult was thrown away as `timeout` after the Worker spent its budget.
//
// The scripted Brain below is the real search on a clock that advances a
// fixed step on every reading: once the rollout reads the cap each ply
// (`RolloutDeadline`), one iteration of a full-round playout "takes" far more
// than the margin. The consult must still end inside cap + margin, with a
// move.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "@convex/gre/ai/blade/runner";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import { searchWithTrace } from "@convex/gre/search";
import { HARDEST_SEARCH_TIME_MS } from "@convex/gre/difficulty";
import {
    BRAIN_CONSULT_OVERRUN_MARGIN_MS,
    BRAIN_CONSULT_TIMEOUT_MS,
    BRAIN_CONSULT_TRANSPORT_MARGIN_MS,
} from "../consult-timeout";

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

/** Scripted milliseconds per clock reading. */
const STEP_MS = 100;

describe("a slow iteration ends at the cap, not past the timeout (issue #10408)", () => {
    it("iterations longer than the overrun margin: the consult returns its move in time", () => {
        const state = buildBladeState({
            label: "consult overshoot fixture",
            spec: SPEC,
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        let t = 0;
        const now = () => (t += STEP_MS);
        const r = searchWithTrace(
            state,
            state.players[0].id,
            { iterations: 10_000, timeMs: HARDEST_SEARCH_TIME_MS, now },
            7
        );
        const trace = r.trace!;
        expect(r.move).not.toBeNull();
        // The premise: each iteration took longer than the whole margin.
        expect(trace.elapsedMs / trace.iterationsCompleted).toBeGreaterThan(
            BRAIN_CONSULT_OVERRUN_MARGIN_MS
        );
        // …and the search still stopped inside cap + margin, the in-flight
        // rollout cut by the cap.
        expect(trace.rolloutCutByClock).toBe(true);
        expect(trace.elapsedMs).toBeLessThanOrEqual(
            HARDEST_SEARCH_TIME_MS + BRAIN_CONSULT_OVERRUN_MARGIN_MS
        );
        expect(
            trace.elapsedMs + BRAIN_CONSULT_TRANSPORT_MARGIN_MS
        ).toBeLessThan(BRAIN_CONSULT_TIMEOUT_MS);
    });
});
