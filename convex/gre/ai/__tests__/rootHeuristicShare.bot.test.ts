// Issue #9045 / PRD #9043 — the Root Heuristic Share through the REAL search,
// on the registry position `rewardTail.bot.test.ts` pins the flat floor on:
// under the base vector's hard clip every root candidate's mean rollout
// reward in this far-behind position is the band floor, so the rollouts
// alone cannot rank the self-draw over the misdirected draw. The one-ply
// Evaluation can (+ for "I draw three", − for "they draw three"), and at the
// base vector's `rootHeuristicShare` its share of the verdict is what ranks
// them — by `score`, the number the verdict is read from, not by the
// `material-tiebreak` alone.
//
// `search.bot.test.ts` proves the blend on a hand-built root; this file
// proves the search inherits it — `Node.policyValues` → `makeRootScorer` →
// `CandidateTrace.score` — on the entry the issue names.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { searchWithTrace, type CandidateTrace } from "../../search";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";

const LABEL =
    "far behind: Ancestral Recall from hand is cast at the BOT (issue #8954)";
const SEED = 1;

function rootCandidates(): {
    chosen: string;
    byLabel: Map<string, CandidateTrace>;
} {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === LABEL);
    if (!scenario) throw new Error(`registry lost the entry: ${LABEL}`);
    const state = buildBladeState(scenario);
    const bot = seatPlayerId(state, scenario.bot);
    const { trace } = searchWithTrace(
        state,
        bot,
        { iterations: scenario.budget.iterations },
        SEED
    );
    if (!trace) throw new Error("search returned no trace");
    return {
        chosen: trace.chosen,
        byLabel: new Map(trace.candidates.map((c) => [c.label, c])),
    };
}

const pick = (
    byLabel: Map<string, CandidateTrace>,
    re: RegExp
): CandidateTrace => {
    const hit = [...byLabel.entries()].find(([l]) => re.test(l));
    if (!hit) throw new Error(`no root candidate matches ${re}`);
    return hit[1];
};

describe("Root Heuristic Share through the search (issue #9045)", () => {
    it("the base vector carries a non-zero share — the one-ply Evaluation has a permanent voice at the root", () => {
        expect(DEFAULT_EVAL_WEIGHTS.rootHeuristicShare).toBeGreaterThan(0);
        expect(DEFAULT_EVAL_WEIGHTS.rootHeuristicShare).toBeLessThan(1);
    });

    it("at the base λ the self-draw ranks above the misdirected draw by blended score, with the rollouts flat", () => {
        const { chosen, byLabel } = rootCandidates();
        const self = pick(byLabel, /Ancestral Recall → .*P1$/);
        const opp = pick(byLabel, /Ancestral Recall → .*P2$/);
        // The rollouts alone are blind here (ADR 0176: every leaf past the
        // clip maps to the band floor) — the mean rewards tie exactly.
        expect(self.meanReward).toBe(opp.meanReward);
        // The one-ply reading is not: drawing three is better than giving
        // three, and the blended score carries that ranking to the verdict.
        expect(self.oneplyReward!).toBeGreaterThan(opp.oneplyReward!);
        expect(self.score).toBeGreaterThan(opp.score);
        expect(chosen).toBe(self.label);
    });
});
