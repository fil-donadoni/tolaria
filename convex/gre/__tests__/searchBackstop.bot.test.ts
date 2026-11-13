// `SearchBudget.backstopMs` (issue #9528): a wall-clock CEILING that is not
// part of the decision. A search that finishes under it answers exactly as
// the same iteration budget without it — unlike `timeMs`, it does not change
// how a starved root is opened — and a search it reaches stops there,
// reporting `stoppedBy: "time"`.
import { describe, expect, it } from "vitest";
import { buildBladeState } from "../ai/blade/runner";
import type { ScenarioSpec } from "../../debugScenarioSpec";
import { searchWithTrace } from "../search";

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
        label: "search backstop fixture",
        spec: SPEC,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    return { state, seat: state.players[0].id };
}

describe("search — the wall-clock backstop (issue #9528)", () => {
    it("unreached, it changes nothing: same move, same iterations, same stop", () => {
        const { state, seat } = position();
        const plain = searchWithTrace(state, seat, { iterations: 60 }, 7);
        const backed = searchWithTrace(
            state,
            seat,
            { iterations: 60, backstopMs: 60_000 },
            7
        );
        expect(backed.move).toEqual(plain.move);
        expect(backed.trace?.iterationsCompleted).toBe(
            plain.trace?.iterationsCompleted
        );
        expect(backed.trace?.stoppedBy).toBe(plain.trace?.stoppedBy);
    });

    it("reached, it stops the search and says the clock did", () => {
        const { state, seat } = position();
        let t = 0;
        // Each reading of the clock advances it 10 ms: the 25 ms backstop is
        // past after a few iterations of a 10,000-iteration budget.
        const now = () => (t += 10);
        const r = searchWithTrace(
            state,
            seat,
            { iterations: 10_000, backstopMs: 25, now },
            7
        );
        expect(r.trace?.stoppedBy).toBe("time");
        expect(r.trace?.iterationsCompleted).toBeLessThan(10);
    });
});
