// The Weight Fit's generated arm (ADR 0186, Decisions 1 and 4): the fit prices
// the generated columns as a correction pulled toward zero, beside the
// hand-written weights pulled toward their prior, and reports what the columns
// bought. An EXPERIMENT ARM: nothing here writes a weight the Bot reads — not
// `fittedEvalWeights.ts`, not `generatedVector/committedWeights.ts`.
//
// ONE PROCEDURE, TWO FITS. The same Eval Pairs, the same squared hinge, the
// same fixed steps, the same options, run twice: once without the generated
// columns (`plain` — the committed weights' own fit, operation for operation)
// and once with them (`joint`). Every number the report prints is the second
// read against the first, so "the generated columns newly satisfy this pair"
// means exactly that: the same fit, with the columns, satisfies it; without
// them, it does not. Under a very strong pull the table rounds to zero and
// `joint`'s hand-written weights are `plain`'s.
//
// THE FIT SIDE ONLY. The Verdicts are split by side BEFORE any position is
// rebuilt: an exam Verdict is never rebuilt, never probed, never paired
// (ADR 0186, Decision 7). `fitInputPairs` then drops the pairs the plain fit
// never reads (an indifferent Verdict's), so both fits read the committed
// fit's own input.
//
// THE CARD RESIDUAL (optional, off by default) is a third pass over `joint`'s
// outcomes (`fitCardResiduals`): reported, never applied.

import { FIT_BASE_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import { pairGeneratedBases, type EvalPair } from "./evalPairs";
import {
    fitCardResiduals,
    fitWeights,
    formatMinimalPairSection,
    minimalPairFitOutcomes,
    minimalPairTally,
    type CardResidualOptions,
    type CardResidualReport,
    type FitPairOutcome,
    type MinimalPairFitOutcome,
    type WeightFitOptions,
    type WeightFitResult,
} from "./fit";
import type { NamedBasis } from "./features";
import { fitInputPairs, verdictSidesOf } from "./heldOut";
import { collectVerdictReport, type VerdictReport } from "./report";
import type { Verdict, VerdictGap } from "./types";

export type GeneratedWeightFitOptions = {
    /** `testPositionKeysOf(<the registry>)`: the split's override. */
    testPositions: ReadonlySet<string>;
    gaps?: readonly VerdictGap[];
    /** The prior both fits start from. Default `FIT_BASE_EVAL_WEIGHTS`, the
     *  committed fit's own. */
    weights?: EvalWeights;
    /** The options of BOTH fits. */
    fit?: WeightFitOptions;
    /** The generated columns' pull to zero. */
    generatedLambda?: number;
    /** The Card Residual pass: absent or `false` runs none. */
    cardResidual?: false | CardResidualOptions;
};

export type GeneratedWeightFitRun = {
    /** The Verdicts the fit read: the fit side of the split, nothing else. */
    fitSide: readonly Verdict[];
    /** The report the pairs were read off, over `fitSide` alone. */
    report: VerdictReport;
    /** The pairs both fits read, in order. */
    pairs: readonly EvalPair[];
    /** The generated basis of each pair, `pairs` order. */
    bases: readonly NamedBasis[];
    plain: WeightFitResult;
    joint: WeightFitResult;
    /** Every complete Minimal Pair, read on each fit's predicted gaps. */
    minimalPairs: {
        plain: MinimalPairFitOutcome[];
        joint: MinimalPairFitOutcome[];
    };
    cardResidual?: CardResidualReport;
};

/** The predicted gaps of a fit, in the shape the Minimal Pair reading takes —
 *  on the report's ordering bar, as `minimalPairFitOutcomes` reads them. */
function predictedPairs(
    result: WeightFitResult
): { verdictId: string; delta: number }[] {
    return result.outcomes.map((o) => ({
        verdictId: o.pair.verdictId,
        delta: o.predicted,
    }));
}

/**
 * Run the generated arm over `verdicts`: split, rebuild the fit side, read
 * every pair's generated basis, fit without and with the generated columns,
 * read the Minimal Pairs as units, and — when asked — fit the Card
 * Residuals. Pure in the fit's sense: identical inputs, identical run, to the
 * bit.
 */
export function runGeneratedWeightFit(
    verdicts: readonly Verdict[],
    options: GeneratedWeightFitOptions
): GeneratedWeightFitRun {
    const { testPositions } = options;
    const weights = options.weights ?? FIT_BASE_EVAL_WEIGHTS;
    const sides = verdictSidesOf(verdicts, testPositions);
    const fitSide = verdicts.filter((v) => sides.get(v.id) === "fit");
    const report = collectVerdictReport(fitSide, {
        testPositions,
        gaps: options.gaps ? [...options.gaps] : undefined,
        weights,
    });
    const pairs = fitInputPairs(report.pairs, fitSide, testPositions);
    const cards =
        options.cardResidual !== undefined && options.cardResidual !== false;
    const read = pairGeneratedBases(fitSide, pairs, weights, { cards });
    const basisOf = (pair: EvalPair) => {
        const basis = read.get(pair);
        if (!basis) throw new Error(`no generated basis for ${pair.verdictId}`);
        return basis;
    };
    const bases = pairs.map((p) => basisOf(p).generated);

    const plain = fitWeights(pairs, weights, options.fit);
    const joint = fitWeights(pairs, weights, options.fit, {
        bases,
        lambda: options.generatedLambda,
    });
    const minimalPairs = {
        plain: minimalPairFitOutcomes(
            fitSide,
            predictedPairs(plain),
            testPositions
        ),
        joint: minimalPairFitOutcomes(
            fitSide,
            predictedPairs(joint),
            testPositions
        ),
    };
    const run: GeneratedWeightFitRun = {
        fitSide,
        report,
        pairs,
        bases,
        plain,
        joint,
        minimalPairs,
    };
    if (cards) {
        run.cardResidual = fitCardResiduals(
            joint,
            weights,
            pairs.map((p) => basisOf(p).cards),
            options.cardResidual || {}
        );
    }
    return run;
}

/** How many columns of a pair's basis the report names beside it. */
const NAMED_CONTRIBUTIONS = 3;

/** The generated columns that moved one pair's gap most under `table`. */
function contributions(
    basis: NamedBasis,
    table: Readonly<Record<string, number>>
): string {
    const rows = basis
        .map(([name, x]) => ({ name, points: x * (table[name] ?? 0) }))
        .filter((r) => r.points !== 0)
        .sort(
            (a, b) =>
                Math.abs(b.points) - Math.abs(a.points) ||
                (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        )
        .slice(0, NAMED_CONTRIBUTIONS);
    if (rows.length === 0) return "no generated column";
    return rows
        .map(
            (r) => `${r.name} ${r.points >= 0 ? "+" : ""}${r.points.toFixed(1)}`
        )
        .join(", ");
}

function pairLine(
    sign: string,
    plain: FitPairOutcome,
    joint: FitPairOutcome,
    basis: NamedBasis,
    table: Readonly<Record<string, number>>
): string {
    return (
        `  ${sign} ${joint.pair.verdictId}\n` +
        `      want  ${joint.pair.right.description}\n` +
        `      over  ${joint.pair.other.description}\n` +
        `      Δ ${plain.predicted.toFixed(1)} → ${joint.predicted.toFixed(1)}  (${contributions(basis, table)})`
    );
}

/** The Minimal Pairs whose reading as a unit the generated columns changed. */
function changedMinimalPairs(
    plain: readonly MinimalPairFitOutcome[],
    joint: readonly MinimalPairFitOutcome[]
): string[] {
    const key = (p: MinimalPairFitOutcome) => `${p.anchorId}/${p.halfId}`;
    const before = new Map(plain.map((p) => [key(p), p]));
    const out: string[] = [];
    for (let i = 0; i < joint.length; i++) {
        const after = joint[i];
        const was = before.get(key(after));
        if (!was || (was.anchor === after.anchor && was.half === after.half)) {
            continue;
        }
        out.push(
            `  ${key(after)}  anchor ${was.anchor} → ${after.anchor}, half ${was.half} → ${after.half}\n` +
                `      Discriminant: ${after.discriminant.kind}: ${after.discriminant.detail}`
        );
    }
    return out;
}

/** How many of the largest generated weights the report lists. */
export const GENERATED_REPORT_TOP = 20;

/**
 * The generated arm's report: how many generated weights stayed at zero, the
 * largest, the hand-written weights the columns displaced, the pairs the
 * columns newly satisfy and newly break (each with the columns that moved it),
 * and the Minimal Pairs read as units under both fits.
 */
export function formatGeneratedWeightFitReport(
    run: GeneratedWeightFitRun,
    top: number = GENERATED_REPORT_TOP
): string {
    const { plain, joint, bases } = run;
    const gen = joint.generated;
    if (!gen) throw new Error("generated report: the joint fit has no table");
    const o = joint.options;
    const out: string[] = [
        `== Weight Fit, generated arm (ADR 0186) — ${run.pairs.length} pairs from ${run.fitSide.length} fit-side verdicts, δ=${o.margin}, λ=${o.lambda}, λ_gen=${gen.lambda}, ${o.steps} steps`,
        `  generated columns loaded : ${gen.columns.length}`,
        `  left at zero             : ${gen.zero}`,
        `  moved                    : ${gen.moved.length}`,
        `  loss                     : ${plain.lossAfter.toFixed(4)} (without) → ${joint.lossAfter.toFixed(4)} (with)`,
        `  pairs separated (≥ δ)    : ${plain.separatedAfter} → ${joint.separatedAfter}`,
        `  pairs ordered (Δ > 0)    : ${plain.orderedAfter} → ${joint.orderedAfter}`,
    ];

    out.push(
        `\n== largest generated weights (${Math.min(top, gen.moved.length)} of ${gen.moved.length}), margin points a unit`
    );
    if (gen.moved.length === 0)
        out.push("  (every generated weight left zero)");
    const largest = gen.moved.slice(0, top);
    for (let i = 0; i < largest.length; i++) {
        const m = largest[i];
        out.push(
            `  ${m.name.padEnd(48)} ${m.weight >= 0 ? "+" : ""}${m.weight}`
        );
    }

    const displaced = joint.movement.filter(
        (m, i) => m.after !== plain.movement[i].after
    );
    out.push(
        `\n== hand-written weights the columns displaced (${displaced.length})`
    );
    if (displaced.length === 0) out.push("  (none)");
    for (let i = 0; i < displaced.length; i++) {
        const m = displaced[i];
        const was = plain.movement.find((p) => p.key === m.key)!;
        out.push(`  ${m.key.padEnd(26)} ${was.after} → ${m.after}`);
    }

    const gained: string[] = [];
    const lost: string[] = [];
    for (let p = 0; p < joint.outcomes.length; p++) {
        const a = plain.outcomes[p];
        const b = joint.outcomes[p];
        if (!a.satisfiedAfter && b.satisfiedAfter) {
            gained.push(pairLine("+", a, b, bases[p], gen.table));
        } else if (a.satisfiedAfter && !b.satisfiedAfter) {
            lost.push(pairLine("−", a, b, bases[p], gen.table));
        }
    }
    out.push(
        `\n== pairs the generated columns NEWLY SATISFY (${gained.length}) / NEWLY BREAK (${lost.length}) — the same fit without them is the baseline`
    );
    if (gained.length + lost.length === 0) out.push("  (none)");
    out.push(...gained, ...lost);

    const mp = run.minimalPairs;
    const before = minimalPairTally(mp.plain);
    const after = minimalPairTally(mp.joint);
    out.push(
        `\n== Minimal Pairs as units, on the fits' predicted gaps — without → with`,
        `  both satisfied           : ${before.both} → ${after.both}`,
        `  one satisfied            : ${before.one} → ${after.one}`,
        `  neither satisfied        : ${before.neither} → ${after.neither}`,
        `  not fitted               : ${before.notFitted} → ${after.notFitted}`
    );
    const changed = changedMinimalPairs(mp.plain, mp.joint);
    out.push(
        `\n== Minimal Pairs whose reading the generated columns changed (${changed.length})`
    );
    if (changed.length === 0) out.push("  (none)");
    out.push(...changed);
    out.push("", formatMinimalPairSection(mp.joint));
    return out.join("\n");
}

/** The Card Residual report: which cards earned one, how large, which hit
 *  the cap, and which pairs only the residuals carry over the margin. A
 *  finding for a column, never a table. */
export function formatCardResidualReport(report: CardResidualReport): string {
    const atCap = report.residuals.filter((r) => r.atCap).length;
    const out: string[] = [
        `== Card Residual (ADR 0186, Decision 4) — REPORTED, never applied; λ_res=${report.lambda}, cap ±${report.cap}`,
        `  card units loaded        : ${report.units}`,
        `  earned a residual        : ${report.residuals.length}`,
        `  at the cap               : ${atCap}`,
        `  pairs only they separate : ${report.newlySatisfied.length}`,
        `\n== residuals, margin points a unit — a large one names a mechanic no column reads`,
    ];
    if (report.residuals.length === 0) out.push("  (no card earned one)");
    for (let i = 0; i < report.residuals.length; i++) {
        const r = report.residuals[i];
        out.push(
            `  ${r.name.padEnd(48)} ${r.residual >= 0 ? "+" : ""}${r.residual}${r.atCap ? "  ← cap" : ""}`
        );
    }
    if (report.newlySatisfied.length > 0) {
        out.push(`\n== pairs the residuals alone carry over the margin`);
        for (let i = 0; i < report.newlySatisfied.length; i++) {
            const o = report.newlySatisfied[i];
            out.push(
                `  ${o.pair.verdictId}\n      want  ${o.pair.right.description}\n      over  ${o.pair.other.description}`
            );
        }
    }
    return out.join("\n");
}
