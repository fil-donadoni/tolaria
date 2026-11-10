// Issue #9045 / PRD #9043 — the Root Heuristic Share through the REAL search,
// on the registry position `rewardTail.bot.test.ts` pins the flat floor on.
//
// Two readings of the same entry, both true and both worth pinning:
//
//  1. Under the base vector's hard clip the ROOT is itself past
//     ±`materialFull` (≈ −815), so the one-ply Evaluation of every candidate
//     maps to the band floor exactly as the rollouts do — the share has
//     nothing to blend, and the pick stays the material tie-break's (ADR 0176
//     named this: the clip is blind wherever it binds, the one-ply reading
//     included). The reconstructed prod position of issue #8954 is NOT this
//     shape — its root is level on board — which is why λ fixes it under the
//     clip (ADR 0177's traces).
//  2. Under `reward-soft-tail` the one-ply reading is distinct ("I draw
//     three" above "they draw three"), and at the base vector's λ the blended
//     score carries that ranking to the verdict — `score`, the number the
//     verdict is read from, not the `material-tiebreak` alone.
//
// `search.bot.test.ts` proves the blend on a hand-built root; this file
// proves the search inherits it — `Node.policyValues` → `makeRootScorer` →
// `CandidateTrace.score` — on the entry the issue names.
import { afterEach, describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { searchWithTrace, type CandidateTrace } from "../../search";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { LADDER_VARIANTS, setSearchVariant } from "../searchVariant";

const LABEL =
    "far behind: Ancestral Recall from hand is cast at the BOT (issue #8954)";
const SEED = 1;

function rootCandidates(): {
    chosen: string;
    mechanism: string;
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
        mechanism: trace.mechanism,
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
const SELF = /Ancestral Recall → .*P1$/;
const OPP = /Ancestral Recall → .*P2$/;

describe("Root Heuristic Share through the search (issue #9045)", () => {
    afterEach(() => setSearchVariant(null));

    it("base vector (hard clip): the one-ply reading is the band floor too, so the share blends nothing and the tie-break keeps the pick", () => {
        const { chosen, mechanism, byLabel } = rootCandidates();
        const self = pick(byLabel, SELF);
        const opp = pick(byLabel, OPP);
        const floor = DEFAULT_EVAL_WEIGHTS.terminalBand;
        expect(self.meanReward).toBe(floor);
        expect(opp.meanReward).toBe(floor);
        expect(self.oneplyReward).toBe(floor);
        expect(opp.oneplyReward).toBe(floor);
        expect(self.score).toBe(floor);
        expect(opp.score).toBe(floor);
        expect(mechanism).toBe("material-tiebreak");
        expect(chosen).toBe(self.label);
    });

    it("reward-soft-tail at the base λ: the self-draw ranks above the misdirected draw by blended score", () => {
        // Only a non-zero share can carry the one-ply ranking into `score`,
        // so this is also the base vector's λ > 0, pinned by what it does.
        expect(DEFAULT_EVAL_WEIGHTS.rootHeuristicShare).toBeGreaterThan(0);
        setSearchVariant(LADDER_VARIANTS["reward-soft-tail"]);
        const { chosen, byLabel } = rootCandidates();
        const self = pick(byLabel, SELF);
        const opp = pick(byLabel, OPP);
        expect(self.oneplyReward!).toBeGreaterThan(opp.oneplyReward!);
        expect(self.score).toBeGreaterThan(opp.score);
        // The blend moved the score off the rollout mean on both.
        expect(self.score).not.toBe(self.meanReward);
        expect(opp.score).not.toBe(opp.meanReward);
        expect(chosen).toBe(self.label);
    });
});
