/**
 * Blade robustness audit — the pure half (issue #4875): classification, the
 * shrink-only baseline comparison, the jitter vectors, and one real audit of
 * a trivial entry. The opt-in runner over the whole `must` tier is
 * `robustness.shard-N.spec.ts` (`bun run blade:robustness`).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_WEIGHTS } from "../../evalWeights";
import { resolveEvalWeights } from "../../searchVariant";
import { FITTABLE_WEIGHT_KEYS, weightValue } from "../../verdicts/features";
import { bladeScenariosForTier, findBladeScenario } from "../registry";
import { ROBUSTNESS_BASELINE } from "../robustnessBaseline";
import type { BladeResult } from "../runner";
import {
    auditBladeScenario,
    classifyRobustness,
    compareRobustness,
    describeRobustnessFindings,
    JITTER_FRACTION,
    parseRobustnessScope,
    ROBUSTNESS_SEEDS,
    robustnessScopeAdmits,
    robustnessVectors,
    type RobustnessLeg,
    type RobustnessRow,
} from "../robustness";

const leg = (passed: number, seeds = 10): RobustnessLeg => ({
    vector: "default",
    seeds,
    passed,
    mechanisms: {},
    failures: [],
});

const row = (
    label: string,
    verdict: RobustnessRow["verdict"]
): RobustnessRow => ({
    label,
    iterations: 200,
    own: { seeds: 1, passed: verdict === "wrong" ? 0 : 1 },
    legs: [leg(verdict === "noise-pinned" ? 9 : 10)],
    verdict,
});

describe("classifyRobustness (issue #4875)", () => {
    it("robust when every run passes", () => {
        expect(
            classifyRobustness({ seeds: 3, passed: 3 }, [leg(10), leg(10)])
        ).toBe("robust");
    });

    it("noise-pinned when the own seeds pass and one wide run fails", () => {
        expect(
            classifyRobustness({ seeds: 3, passed: 3 }, [leg(10), leg(9)])
        ).toBe("noise-pinned");
    });

    it("wrong when an own seed fails, whatever the wide runs say", () => {
        expect(
            classifyRobustness({ seeds: 3, passed: 2 }, [leg(10), leg(10)])
        ).toBe("wrong");
    });
});

describe("compareRobustness — the shrink-only baseline (issue #4875)", () => {
    const baseline = [
        { label: "pinned-listed", issue: 4874 },
        { label: "was-pinned", issue: 4768 },
    ];

    it("a listed pin is clean; an unlisted pin reds", () => {
        const f = compareRobustness(
            [
                row("pinned-listed", "noise-pinned"),
                row("new-pin", "noise-pinned"),
            ],
            baseline
        );
        expect(f.unlisted).toEqual(["new-pin"]);
        expect(f.cleared).toEqual([]);
    });

    it("a listed entry that became robust reds until its row is deleted", () => {
        const f = compareRobustness([row("was-pinned", "robust")], baseline);
        expect(f.cleared).toEqual(["was-pinned"]);
    });

    it("a baseline row whose entry is outside the slice is not judged", () => {
        const f = compareRobustness([row("other", "robust")], baseline);
        expect(describeRobustnessFindings(f)).toEqual([]);
    });

    it("an entry failing its own seeds reds, listed or not", () => {
        const f = compareRobustness([row("pinned-listed", "wrong")], baseline);
        expect(f.wrong).toEqual(["pinned-listed"]);
    });

    it("checks the baseline's shape against the must labels", () => {
        const f = compareRobustness(
            [],
            [
                { label: "a", issue: 1 },
                { label: "a", issue: 1 },
                { label: "gone", issue: 2 },
                { label: "b", issue: 0 },
            ],
            { mustLabels: ["a", "b"] }
        );
        expect(f.malformed).toEqual([
            "a: listed twice",
            "gone: not a must entry",
            "b: no follow-up issue",
        ]);
    });
});

describe("robustnessVectors (issue #4875)", () => {
    const [, plus, minus] = robustnessVectors();

    it("moves every fittable weight by exactly ±JITTER_FRACTION, antithetically", () => {
        const up = resolveEvalWeights(plus.variant);
        const down = resolveEvalWeights(minus.variant);
        for (const key of FITTABLE_WEIGHT_KEYS) {
            const w = weightValue(DEFAULT_EVAL_WEIGHTS, key);
            const ratioUp = weightValue(up, key) / w;
            const ratioDown = weightValue(down, key) / w;
            expect(Math.abs(ratioUp - 1), key).toBeCloseTo(JITTER_FRACTION, 12);
            expect(ratioUp - 1 + (ratioDown - 1), key).toBeCloseTo(0, 12);
        }
    });

    it("moves weights in BOTH directions within one vector", () => {
        const up = resolveEvalWeights(plus.variant);
        const signs = FITTABLE_WEIGHT_KEYS.map((key) =>
            Math.sign(
                weightValue(up, key) - weightValue(DEFAULT_EVAL_WEIGHTS, key)
            )
        );
        expect(new Set(signs)).toEqual(new Set([1, -1]));
    });

    it("is deterministic", () => {
        expect(robustnessVectors()).toEqual(robustnessVectors());
    });
});

describe("auditBladeScenario — a real audit (issue #4875)", () => {
    it("runs every wide seed and records the root mechanism of each", () => {
        const scenario = findBladeScenario(
            "positive-control: plays its only land on an empty board"
        )!;
        const result = auditBladeScenario(scenario, [
            { name: "default", variant: null },
        ]);
        expect(result.verdict).toBe("robust");
        expect(result.legs[0].seeds).toBe(ROBUSTNESS_SEEDS.length);
        expect(result.legs[0].mechanisms.none).toBeUndefined();
        expect(
            Object.values(result.legs[0].mechanisms).reduce((a, b) => a + b, 0)
        ).toBe(ROBUSTNESS_SEEDS.length);
    });
});

describe("robustnessScopeAdmits — the near-tie slice `land` runs (issue #5016)", () => {
    const own = (
        label: string,
        mechanisms: BladeResult["seeds"][number]["mechanism"][]
    ): BladeResult => ({
        label,
        tier: "must",
        ok: true,
        failureMessage: "",
        seeds: mechanisms.map((mechanism, seed) => ({
            seed,
            move: null,
            moveDescription: "",
            ok: true,
            reason: "",
            mechanism,
        })),
    });

    it("admits an entry one of whose own seeds settled by material-tiebreak", () => {
        expect(
            robustnessScopeAdmits(
                "tiebreak",
                own("near-tie", ["mean-reward", "material-tiebreak"]),
                []
            )
        ).toBe(true);
    });

    it("skips an entry whose own seeds all settled without a tie-break", () => {
        expect(
            robustnessScopeAdmits(
                "tiebreak",
                own("decided", ["mean-reward", "hold-trick", null]),
                []
            )
        ).toBe(false);
    });

    it("always admits a baseline row, so a cleared row still reds", () => {
        expect(
            robustnessScopeAdmits("tiebreak", own("listed", ["mean-reward"]), [
                { label: "listed", issue: 4982 },
            ])
        ).toBe(true);
    });

    it("the full scope admits everything", () => {
        expect(
            robustnessScopeAdmits("all", own("decided", ["mean-reward"]), [])
        ).toBe(true);
    });

    it("parses the env knob, failing loud on a typo", () => {
        expect(parseRobustnessScope(undefined)).toBe("all");
        expect(parseRobustnessScope("tiebreak")).toBe("tiebreak");
        expect(() => parseRobustnessScope("tie-break")).toThrow(
            /BLADE_ROBUSTNESS_SCOPE/
        );
    });
});

describe("the committed baseline's shape (issue #5016)", () => {
    // The audit itself is health-only and its drift is filed, not gated; the
    // shape of the baseline needs no search, so a malformed row is refused
    // here, at `land`.
    it("names must entries, once each, with an issue", () => {
        const findings = compareRobustness([], ROBUSTNESS_BASELINE, {
            mustLabels: bladeScenariosForTier("must").map((s) => s.label),
        });
        expect(describeRobustnessFindings(findings)).toEqual([]);
    });
});
