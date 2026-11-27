// The Weight Fit's generated arm (ADR 0186, Decisions 1 and 4; issue #10863):
// the fit prices the generated columns as a correction pulled toward zero,
// and the Card Residual is fitted in a separate pass that is only reported.
//
// Two halves. The CONTRACT, on hand-built pairs whose answer is known by
// construction: a column only the generated block reads earns a weight, a
// strong pull silences it, the hand-written weights are the plain fit's when
// no column moves, and the residual stays under its cap. Then the COMMITTED
// CORPUS, the same registry and lock the reproducibility guard fits: the arm
// reproduces itself to the bit, collapses onto the committed weights under a
// strong pull, prices the Evaluation's own reading of the table, and never
// rebuilds an exam-side Verdict.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/registry";
import { FIT_BASE_EVAL_WEIGHTS } from "../evalWeights";
import {
    CARD_RESIDUAL_CAP,
    collectVerdictReport,
    FITTABLE_WEIGHT_KEYS,
    fitCardResiduals,
    fittableWeightsEqual,
    fitWeights,
    formatCardResidualReport,
    formatGeneratedWeightFitReport,
    runGeneratedWeightFit,
    testPositionKeysOf,
    verdictSidesOf,
    type EvalPair,
    type FittableWeightKey,
    type NamedBasis,
} from "../verdicts";
import {
    committedVerdictCorpus,
    CORPUS_EXCLUDED,
} from "./committedVerdictCorpus.fixture";

function zeroBasis(): Record<FittableWeightKey, number> {
    const basis = {} as Record<FittableWeightKey, number>;
    for (const k of FITTABLE_WEIGHT_KEYS) basis[k] = 0;
    return basis;
}

/** A pair the hand-written weights cannot see: zero basis, gap `delta`. */
function blindPair(verdictId: string, delta: number): EvalPair {
    return {
        verdictId,
        kind: "right",
        rightIndex: 0,
        otherIndex: 1,
        right: { key: "a", description: "the right move" },
        other: { key: "b", description: "the other move" },
        terms: {} as EvalPair["terms"],
        basis: zeroBasis(),
        fittableDelta: 0,
        delta,
    };
}

/** A pair the hand-written weights CAN reach, through `permanentWeight`. */
function permanentPair(verdictId: string, delta: number): EvalPair {
    const pair = blindPair(verdictId, delta);
    pair.basis.permanentWeight = 4;
    pair.fittableDelta = 4 * FIT_BASE_EVAL_WEIGHTS.permanentWeight;
    return pair;
}

describe("the generated arm's contract (ADR 0186, issue #10863)", () => {
    // Twenty pairs, ten of them blind to every hand-written weight and read
    // only by `col.x`: the column has the examples, so it earns a weight.
    const pairs: EvalPair[] = [];
    const bases: NamedBasis[] = [];
    for (let i = 0; i < 10; i++) {
        pairs.push(blindPair(`blind:${i}`, 0));
        bases.push([["col.x", 1]]);
        pairs.push(permanentPair(`perm:${i}`, 20));
        bases.push([]);
    }

    it("prices a column only the generated block reads, and the plain fit cannot", () => {
        const plain = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS);
        const joint = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS, {}, { bases });
        expect(plain.generated).toBeUndefined();
        expect(joint.generated!.columns).toEqual(["col.x"]);
        const weight = joint.generated!.table["col.x"];
        expect(weight).toBeGreaterThan(0);
        // The blind pairs gain exactly what the column's weight buys.
        const blind = joint.outcomes.find(
            (o) => o.pair.verdictId === "blind:0"
        )!;
        expect(blind.predicted).toBeCloseTo(weight, 9);
        expect(
            plain.outcomes.find((o) => o.pair.verdictId === "blind:0")!
                .predicted
        ).toBe(0);
    });

    it("a column ONE pair loads stays below one permanent at the default pull", () => {
        const one = bases.map((b, p) => (p === 0 ? b : []));
        const joint = fitWeights(
            pairs,
            FIT_BASE_EVAL_WEIGHTS,
            {},
            { bases: one }
        );
        expect(Math.abs(joint.generated!.table["col.x"] ?? 0)).toBeLessThan(
            FIT_BASE_EVAL_WEIGHTS.permanentWeight
        );
    });

    it("under a very strong pull the table is empty and the hand-written weights are the plain fit's", () => {
        const plain = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS);
        const joint = fitWeights(
            pairs,
            FIT_BASE_EVAL_WEIGHTS,
            {},
            { bases, lambda: 1e12 }
        );
        expect(joint.generated!.table).toEqual({});
        expect(joint.generated!.zero).toBe(1);
        expect(joint.weights).toEqual(plain.weights);
    });

    it("is deterministic to the bit", () => {
        const a = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS, {}, { bases });
        const b = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS, {}, { bases });
        expect(JSON.stringify(b.generated)).toBe(JSON.stringify(a.generated));
        expect(b.weights).toEqual(a.weights);
        expect(b.lossAfter).toBe(a.lossAfter);
    });

    it("the Card Residual is capped, and is a report rather than a table", () => {
        // A blind pair no column reads, with a gap the cap cannot close.
        const lone = [blindPair("card:0", -300)];
        const fit = fitWeights(
            lone,
            FIT_BASE_EVAL_WEIGHTS,
            {},
            { bases: [[]] }
        );
        const report = fitCardResiduals(
            fit,
            FIT_BASE_EVAL_WEIGHTS,
            [[["Grizzly Bears@battlefield.self", 1]]],
            { lambda: 0 }
        );
        expect(report.residuals).toEqual([
            {
                name: "Grizzly Bears@battlefield.self",
                residual: CARD_RESIDUAL_CAP,
                atCap: true,
            },
        ]);
        expect(report).not.toHaveProperty("table");
        expect(formatCardResidualReport(report)).toContain("← cap");
    });
});

const describeLockedCorpus = describe.skipIf(CORPUS_EXCLUDED);

describeLockedCorpus(
    "the generated arm over the committed corpus (issue #10863)",
    () => {
        const testPositions = testPositionKeysOf(BLADE_SCENARIOS);
        const runOnce = async () => {
            const { verdicts, gaps } = await committedVerdictCorpus();
            return {
                verdicts,
                run: runGeneratedWeightFit(verdicts, {
                    testPositions,
                    gaps,
                    cardResidual: {},
                }),
            };
        };
        const first = runOnce();

        it("reproduces its own table and weights to the bit", async () => {
            const { run: a } = await first;
            const { run: b } = await runOnce();
            expect(JSON.stringify(b.joint.generated)).toBe(
                JSON.stringify(a.joint.generated)
            );
            expect(b.joint.weights).toEqual(a.joint.weights);
            expect(JSON.stringify(b.cardResidual)).toBe(
                JSON.stringify(a.cardResidual)
            );
            expect(a.joint.generated!.columns.length).toBeGreaterThan(0);
        }, 300_000);

        // The plain fit IS the committed weights' fit: `weightFit.bot.test.ts`
        // (the reproducibility guard) pins it equal to `DEFAULT_EVAL_WEIGHTS`.
        // This test reads the weights through that fit rather than through
        // their literals, so a refit moving the last digit does not red it.
        it("under a very strong pull the table is empty and the weights are the committed fit's", async () => {
            const { run } = await first;
            const silenced = fitWeights(
                run.pairs,
                FIT_BASE_EVAL_WEIGHTS,
                {},
                {
                    bases: run.bases,
                    lambda: 1e12,
                }
            );
            expect(silenced.generated!.table).toEqual({});
            expect(
                fittableWeightsEqual(silenced.weights, run.plain.weights)
            ).toBe(true);
        }, 300_000);

        it("the basis is the Evaluation's own reading of a generated table", async () => {
            // Price the fitted table through the Evaluation and re-derive one
            // pair: its gap moves by exactly `Σ g_c · x_c` of the basis.
            const { run } = await first;
            const table = run.joint.generated!.table;
            const p = run.pairs.findIndex(
                (pair, i) =>
                    pair.kind === "right" &&
                    run.bases[i].some(([name]) => (table[name] ?? 0) !== 0)
            );
            expect(p).toBeGreaterThanOrEqual(0);
            const pair = run.pairs[p];
            const verdict = run.fitSide.find((v) => v.id === pair.verdictId)!;
            const repriced = collectVerdictReport([verdict], {
                testPositions,
                weights: { ...FIT_BASE_EVAL_WEIGHTS, generatedWeights: table },
            }).pairs.find(
                (q) =>
                    q.rightIndex === pair.rightIndex &&
                    q.otherIndex === pair.otherIndex
            )!;
            let predicted = 0;
            for (const [name, x] of run.bases[p])
                predicted += x * (table[name] ?? 0);
            expect(predicted).not.toBe(0);
            expect(repriced.delta - pair.delta).toBeCloseTo(predicted, 6);
        }, 300_000);

        it("never rebuilds an exam-side Verdict", async () => {
            const { verdicts, run } = await first;
            const sides = verdictSidesOf(verdicts, testPositions);
            const exam = new Set(
                verdicts
                    .filter((v) => sides.get(v.id) !== "fit")
                    .map((v) => v.id)
            );
            // The corpus holds an exam side, so the assertion below can fail.
            expect(exam.size).toBeGreaterThan(0);
            const read = [
                ...run.fitSide.map((v) => v.id),
                ...run.report.rows.map((r) => r.verdictId),
                ...run.report.errors.map((e) => e.verdictId),
                ...run.pairs.map((p) => p.verdictId),
            ];
            expect(read.filter((id) => exam.has(id))).toEqual([]);
        }, 300_000);

        it("prints the report: zero count, largest weights, pairs newly satisfied and broken, Minimal Pairs as units", async () => {
            const { run } = await first;
            const text = formatGeneratedWeightFitReport(run);
            expect(text).toContain("left at zero");
            expect(text).toContain("largest generated weights");
            expect(text).toContain("NEWLY SATISFY");
            expect(text).toContain("Minimal Pairs as units");
        }, 300_000);
    }
);
