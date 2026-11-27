// The Census gate of the generated vector (ADR 0186): which Eval Pairs the
// Evaluation reads as ONE board, and how many of them the generated vector
// tells apart — with no fit, no weight, no change to the Bot (issue #10857).
//
// TWO VECTORS, ONE PAIR SET. "Current" is the pair as `report.ts` classifies
// it: the fittable basis, the term breakdown and the policy value. "Current +
// generated" appends the generated vector's difference between the two
// candidates' settled boards (`generatedVector/pairReadings.ts`) to the same
// pair. Nothing else moves: the pairs, their decision class and what is
// satisfied are the current report's, because no weight has been fitted to
// the new columns and "satisfied" is a statement about weights.
//
//   - BLIND under both: blind now (`isBlindPair`) AND an empty generated
//     difference. The generated vector can only remove pairs from blind.
//   - CONTRADICTORY under both: anti-parallel over the concatenated vector,
//     by the same unit-normalised, 1e-6-grid direction key `report.ts` uses
//     for the basis alone. A couple can leave (its generated halves are not
//     each other's negation) and a couple can arrive (two pairs blind today
//     whose generated differences are exact negatives).
//   - ADDRESSABLE: `violated − blind − contradictory`, a pair in both
//     subtracted once, as `coverage.ts` counts it.
//
// THE PASS RULE was registered before measuring (issue #10857): the generated
// vector gives different vectors to at least half of the blind pairs that are
// not VACUOUS — two copies of one card, which no evaluation should tell
// apart and which therefore sit outside the denominator (`vacuous` is read by
// the interchangeability keyer, the authority the candidate collapse uses).
//
// Pure: the readings are handed in, so this module imports no engine and the
// census is testable on hand-built pairs.

import { DECISION_CLASSES, pairDecisionClass } from "./coverage";
import type { DecisionClass } from "./coverage";
import type { EvalPair } from "./evalPairs";
import { FITTABLE_WEIGHT_KEYS } from "./features";
import { isBlindPair, type VerdictReport } from "./report";

/** One Eval Pair as the generated vector reads it. */
export type GeneratedPairReading = {
    /** `x_gen(right) − x_gen(other)` as `[column, count]` rows in column
     *  order, zero columns omitted. Empty: the generated vector reads the two
     *  settled boards as one. */
    difference: readonly (readonly [string, number])[];
    /** The two candidates are the same move up to which copy of a card
     *  (`makeInterchangeableKeyer`). */
    vacuous: boolean;
};

/** The three unreachable-or-not columns under one vector. */
export type VectorCounts = {
    blind: number;
    contradictory: number;
    addressable: number;
};

export type GeneratedCoverageRow = {
    class: DecisionClass | "unclassified";
    pairs: number;
    violated: number;
    current: VectorCounts;
    combined: VectorCounts;
    /** Blind now, of them vacuous: outside the pass rule's denominator. */
    vacuousBlind: number;
    /** Blind now, not vacuous, and given different generated vectors. */
    separated: number;
};

/** A pair the generated vector leaves blind, for the note to name. */
export type StillBlindPair = {
    verdictId: string;
    class: DecisionClass | "unclassified";
    right: string;
    other: string;
    vacuous: boolean;
};

export type GeneratedCoverage = {
    rows: GeneratedCoverageRow[];
    totals: Omit<GeneratedCoverageRow, "class">;
    stillBlind: StillBlindPair[];
    rule: {
        /** Blind now and not vacuous: the denominator. */
        nonVacuousBlind: number;
        separated: number;
        /** `separated` must reach this: half the denominator, rounded up. */
        required: number;
        pass: boolean;
    };
};

/** The registered pass rule: at least half of the non-vacuous blind pairs. */
export function generatedCensusRequired(nonVacuousBlind: number): number {
    return Math.ceil(nonVacuousBlind / 2);
}

/** Direction key of a pair over basis + generated difference, sign-flipped
 *  by `sign` — `basisDirectionKey`'s grid, over the longer vector. */
function combinedDirectionKey(
    pair: EvalPair,
    difference: GeneratedPairReading["difference"],
    sign: 1 | -1
): string {
    let norm = 0;
    for (let i = 0; i < FITTABLE_WEIGHT_KEYS.length; i++) {
        norm += pair.basis[FITTABLE_WEIGHT_KEYS[i]] ** 2;
    }
    for (let i = 0; i < difference.length; i++) {
        norm += difference[i][1] ** 2;
    }
    norm = Math.sqrt(norm) || 1;
    // `+ 0` folds the negative zero `-1 * 0` gives, as `report.ts` does.
    const grid = (value: number) =>
        (Math.round((sign * value * 1e6) / norm) / 1e6 + 0).toString();
    const basis = FITTABLE_WEIGHT_KEYS.map((k) => grid(pair.basis[k]));
    const generated = difference.map(
        ([name, count]) => `${name}=${grid(count)}`
    );
    return `${basis.join("|")}#${generated.join("|")}`;
}

/** The pairs that belong to a contradictory couple over the combined
 *  vector. Blind-under-both pairs are held out, like `contradictoryCouples`
 *  holds out blind ones: the zero vector is its own negation. */
function combinedContradictory(
    pairs: readonly EvalPair[],
    readingOf: (pair: EvalPair) => GeneratedPairReading,
    blindCombined: ReadonlySet<EvalPair>
): Set<EvalPair> {
    const byKey = new Map<string, EvalPair[]>();
    const out = new Set<EvalPair>();
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        if (blindCombined.has(pair)) continue;
        const { difference } = readingOf(pair);
        const opposite = byKey.get(combinedDirectionKey(pair, difference, -1));
        if (opposite) {
            out.add(pair);
            for (let j = 0; j < opposite.length; j++) out.add(opposite[j]);
        }
        const key = combinedDirectionKey(pair, difference, 1);
        const bucket = byKey.get(key);
        if (bucket) bucket.push(pair);
        else byKey.set(key, [pair]);
    }
    return out;
}

const EMPTY_COUNTS = (): VectorCounts => ({
    blind: 0,
    contradictory: 0,
    addressable: 0,
});

const EMPTY_ROW = (
    cls: GeneratedCoverageRow["class"]
): GeneratedCoverageRow => ({
    class: cls,
    pairs: 0,
    violated: 0,
    current: EMPTY_COUNTS(),
    combined: EMPTY_COUNTS(),
    vacuousBlind: 0,
    separated: 0,
});

/** Count one violated pair under one vector. */
function tally(
    counts: VectorCounts,
    isBlind: boolean,
    isContradictory: boolean
): void {
    if (isBlind) counts.blind += 1;
    if (isContradictory) counts.contradictory += 1;
    if (!isBlind && !isContradictory) counts.addressable += 1;
}

/**
 * The census of `report`'s pairs under the current vector and under the
 * current plus generated one. `readingOf` must answer for every pair of
 * `report.pairs`.
 */
export function generatedCoverage(
    report: VerdictReport,
    readingOf: (pair: EvalPair) => GeneratedPairReading
): GeneratedCoverage {
    const satisfied = new Set(report.satisfied);
    const blindNow = new Set(report.blind);
    const contradictoryNow = new Set<EvalPair>();
    for (let i = 0; i < report.contradictions.length; i++) {
        contradictoryNow.add(report.contradictions[i].a);
        contradictoryNow.add(report.contradictions[i].b);
    }
    const blindCombined = new Set(
        report.pairs.filter(
            (p) => isBlindPair(p) && readingOf(p).difference.length === 0
        )
    );
    const contradictoryCombined = combinedContradictory(
        report.pairs,
        readingOf,
        blindCombined
    );

    const rows = new Map<GeneratedCoverageRow["class"], GeneratedCoverageRow>();
    const stillBlind: StillBlindPair[] = [];
    for (let i = 0; i < report.pairs.length; i++) {
        const pair = report.pairs[i];
        const cls = pairDecisionClass(pair);
        const row = rows.get(cls) ?? EMPTY_ROW(cls);
        rows.set(cls, row);
        row.pairs += 1;
        if (satisfied.has(pair)) continue;
        row.violated += 1;
        const reading = readingOf(pair);
        const isBlindNow = blindNow.has(pair);
        const isBlindCombined = blindCombined.has(pair);
        tally(row.current, isBlindNow, contradictoryNow.has(pair));
        tally(row.combined, isBlindCombined, contradictoryCombined.has(pair));
        if (isBlindNow && reading.vacuous) row.vacuousBlind += 1;
        if (isBlindNow && !reading.vacuous && !isBlindCombined) {
            row.separated += 1;
        }
        if (isBlindCombined) {
            stillBlind.push({
                verdictId: pair.verdictId,
                class: cls,
                right: pair.right.description,
                other: pair.other.description,
                vacuous: reading.vacuous,
            });
        }
    }

    const order: GeneratedCoverageRow["class"][] = [
        ...DECISION_CLASSES,
        "unclassified",
    ];
    const ordered = order.flatMap((cls) => {
        const found = rows.get(cls);
        return found ? [found] : [];
    });
    const add = (a: VectorCounts, b: VectorCounts): VectorCounts => ({
        blind: a.blind + b.blind,
        contradictory: a.contradictory + b.contradictory,
        addressable: a.addressable + b.addressable,
    });
    const totals = ordered.reduce<Omit<GeneratedCoverageRow, "class">>(
        (acc, r) => ({
            pairs: acc.pairs + r.pairs,
            violated: acc.violated + r.violated,
            current: add(acc.current, r.current),
            combined: add(acc.combined, r.combined),
            vacuousBlind: acc.vacuousBlind + r.vacuousBlind,
            separated: acc.separated + r.separated,
        }),
        {
            pairs: 0,
            violated: 0,
            current: EMPTY_COUNTS(),
            combined: EMPTY_COUNTS(),
            vacuousBlind: 0,
            separated: 0,
        }
    );

    const nonVacuousBlind = totals.current.blind - totals.vacuousBlind;
    const required = generatedCensusRequired(nonVacuousBlind);
    stillBlind.sort(
        (a, b) =>
            order.indexOf(a.class) - order.indexOf(b.class) ||
            a.verdictId.localeCompare(b.verdictId)
    );
    return {
        rows: ordered,
        totals,
        stillBlind,
        rule: {
            nonVacuousBlind,
            separated: totals.separated,
            required,
            pass: totals.separated >= required,
        },
    };
}

function cell(value: string, width: number, start = true): string {
    if (value.length >= width) return value;
    const fill = " ".repeat(width - value.length);
    return start ? fill + value : value + fill;
}

/** `now→gen`, the two vectors' count side by side. */
function both(now: number, gen: number): string {
    return `${now}→${gen}`;
}

/** The census as a fixed-width table, the rule's verdict and every pair left
 *  blind — the receipt a research note pastes unchanged. */
export function formatGeneratedCoverage(coverage: GeneratedCoverage): string {
    const header = [
        cell("class", 18, false),
        cell("pairs", 6),
        cell("viol", 5),
        cell("blind", 8),
        cell("contra", 8),
        cell("addressable", 12),
        cell("vacuous", 8),
        cell("separated", 10),
    ].join(" ");
    const line = (
        label: string,
        r: Omit<GeneratedCoverageRow, "class">
    ): string =>
        [
            cell(label, 18, false),
            cell(`${r.pairs}`, 6),
            cell(`${r.violated}`, 5),
            cell(both(r.current.blind, r.combined.blind), 8),
            cell(both(r.current.contradictory, r.combined.contradictory), 8),
            cell(both(r.current.addressable, r.combined.addressable), 12),
            cell(`${r.vacuousBlind}`, 8),
            cell(`${r.separated}`, 10),
        ].join(" ");
    const { rule } = coverage;
    const verdict =
        `pass rule: separated ≥ ceil(non-vacuous blind / 2) — ` +
        `${rule.separated} ≥ ${rule.required} of ${rule.nonVacuousBlind}: ` +
        (rule.pass ? "PASS" : "FAIL");
    const blindLines =
        coverage.stillBlind.length === 0
            ? ["no pair stays blind"]
            : [
                  `still blind under current + generated (${coverage.stillBlind.length}):`,
              ].concat(
                  coverage.stillBlind.map(
                      (p) =>
                          `  ${cell(p.class, 18, false)} ${p.verdictId}: ` +
                          `"${p.right}" over "${p.other}"` +
                          (p.vacuous ? " [vacuous]" : "")
                  )
              );
    return [
        "columns: current→current+generated (blind, contra, addressable)",
        header,
        ...coverage.rows.map((r) => line(r.class, r)),
        line("TOTAL", coverage.totals),
        "",
        verdict,
        "",
        ...blindLines,
    ].join("\n");
}
