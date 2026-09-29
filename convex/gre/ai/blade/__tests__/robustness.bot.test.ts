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
import { findBladeScenario } from "../registry";
import {
    auditBladeScenario,
    classifyRobustness,
    compareRobustness,
    describeRobustnessFindings,
    JITTER_FRACTION,
    ROBUSTNESS_SEEDS,
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
    });
});
