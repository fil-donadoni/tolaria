// Issue #8954 / ADR 0176 — the reward tail seen through the REAL search, on
// a registry position: under the pre-#8954 hard clip every root candidate's
// mean reward in a far-behind position is the band floor (flat), under the
// compressive tail the means are distinct and the self-draw leads.
//
// `rewardMapping.bot.test.ts` proves the function; this file proves the
// search inherits the property — `scoreLeaf` → `rewardFromValue` → the
// edges' `totalReward` — and that the ranking it yields is the one the
// blade entry demands, not merely the `material-tiebreak`'s.
import { afterEach, describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { searchWithTrace } from "../../search";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { LADDER_VARIANTS, setSearchVariant } from "../searchVariant";

const LABEL =
    "far behind: Ancestral Recall from hand is cast at the BOT, the reward no longer flat (issue #8954)";
const SEED = 1;

function rootMeans(): {
    chosen: string;
    byLabel: Map<string, number>;
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
        byLabel: new Map(trace.candidates.map((c) => [c.label, c.meanReward])),
    };
}

const labelOf = (byLabel: Map<string, number>, re: RegExp): string => {
    const hit = [...byLabel.keys()].find((l) => re.test(l));
    if (!hit) throw new Error(`no root candidate matches ${re}`);
    return hit;
};

describe("reward tail through the search (issue #8954)", () => {
    afterEach(() => setSearchVariant(null));

    it("hard clip: every far-behind root candidate scores exactly the band floor", () => {
        setSearchVariant(LADDER_VARIANTS["reward-hard-clip"]);
        const { byLabel } = rootMeans();
        expect(byLabel.size).toBeGreaterThanOrEqual(3);
        for (const mean of byLabel.values()) {
            expect(mean).toBe(DEFAULT_EVAL_WEIGHTS.terminalBand);
        }
    });

    it("compressive tail: the means are distinct, the self-draw leads and the misdirected draw trails", () => {
        const { chosen, byLabel } = rootMeans();
        const means = [...byLabel.values()];
        expect(new Set(means).size).toBe(means.length);
        const self = labelOf(byLabel, /Ancestral Recall → .*P1$/);
        const opp = labelOf(byLabel, /Ancestral Recall → .*P2$/);
        const pass = labelOf(byLabel, /^pass$/);
        expect(byLabel.get(self)!).toBeGreaterThan(byLabel.get(pass)!);
        expect(byLabel.get(pass)!).toBeGreaterThan(byLabel.get(opp)!);
        expect(chosen).toBe(self);
    });
});
