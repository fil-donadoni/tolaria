// The Eval Pair report — no fit yet (issue #3400, PRD #3397 story 5/6).
//
// Walks every pair of every verdict under the CURRENT weights and answers
// three questions, which are the three the Weight Fit will need answered
// before it is allowed to move anything:
//
//   1. Which pairs does the evaluation already order correctly? That count is
//      the BEFORE-STATE — the evaluation's own pass-rate on the same corpus
//      the blade suite measures the search on, and the number a refit has to
//      beat (ADR 0124 §2).
//   2. Which pairs does it get backwards? Each is printed with its verdict,
//      the two candidates and the term deltas, because "which term is wrong"
//      is the only actionable form of that answer.
//   3. Which pairs are CONTRADICTORY — identical feature vectors, opposite
//      order? No weight vector satisfies both, so they are not a fit failure
//      but a data failure: one of the two verdicts is wrong, or the position
//      differs in something no evaluation term can see. Surfaced by reading
//      (PRD story 6), never by a weaker Bot.
//
// Contradiction is decided on the FITTABLE basis, not on the full policy-value
// gap: the constraint a fit solves is `w · Δbasis ≥ δ`, so two pairs whose
// `Δbasis` are exact negatives are unsatisfiable together for EVERY `w`,
// whatever their residuals do. A pair whose residual alone decides it (a
// terminal win, the Danger Clock) is not contradictory — it is simply out of
// the fit's reach, which the violated list already says.
//
// A FOURTH answer falls out of the same arithmetic and is kept separate: the
// BLIND pair, where the evaluation cannot tell the two candidates apart AT
// ALL. That is what ADR 0124 §3 means by "the pairs the fit could not satisfy
// are reported, never dropped — they name a missing term", and it is, verbatim,
// the identical-feature-vector proof the root-rule moratorium (§5) demands
// before a decision may be settled at the root instead. Which makes the TEST
// for it load-bearing, and a zero `Δbasis` alone is NOT that test: several
// evaluation terms carry no `EvalWeights` scalar at all (`creatureValueRaw`,
// `nonCreatureBodyValue`, a hand card's clamped floor), so a pair the
// `creatures` term separates by 302 points reads as a zero basis delta —
// measured, 5 of the 30 must-tier pairs a basis-only test called blind. A root
// rule admitted on that "proof" would be admitted over a pair an EXISTING term
// already separates.
//
// So blind means all three at once: no fittable weight moves it (`Δbasis`
// zero), no evaluation term moves it (`Δterms` zero), and the decider does not
// separate them either (`Δpolicy` zero — the Danger Clock and the two combat
// corrections live outside `EvalTerms` and would otherwise slip through).
// Every blind pair is therefore also a violated one, which is the honest
// reading: a decision the evaluation cannot make.
//
// Blind pairs are held OUT of the contradiction scan for an arithmetic reason
// as well: the zero vector is its own negation, so N of them read as N² false
// disagreements (measured: 492 before the split, 53 after).

import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import {
    EVAL_TERM_KEYS,
    FITTABLE_WEIGHT_KEYS,
    type FittableWeightKey,
} from "./features";
import { evalPairsOf, type EvalPair } from "./evalPairs";
import type { Verdict, VerdictGap } from "./types";

/** How much of a gap counts as "ordered correctly". Strictly positive: a tie
 *  is not a correct ordering — it is exactly the shape where the pick falls to
 *  rollout noise (`/bot-slice` phase 0, step 2). */
const SATISFIED_EPS = 1e-9;

/** One verdict's outcome. `ok` — every pair it yields is ordered correctly, so
 *  the evaluation alone would rank the judged move top. */
export type VerdictRow = {
    verdictId: string;
    kind: "right" | "forbidden";
    candidates: number;
    pairs: number;
    violated: number;
    ok: boolean;
    error?: string;
};

export type Contradiction = { a: EvalPair; b: EvalPair };

/** Can the evaluation tell this pair's two candidates apart in ANY way it
 *  exposes? No fittable weight, no evaluation term, and not the decider's own
 *  number — see the header for why all three are needed. */
function isBlind(pair: EvalPair): boolean {
    return (
        FITTABLE_WEIGHT_KEYS.every(
            (k) => Math.abs(pair.basis[k]) < BASIS_EPS
        ) &&
        EVAL_TERM_KEYS.every((k) => Math.abs(pair.terms[k]) < TERM_EPS) &&
        Math.abs(pair.delta) < TERM_EPS
    );
}

/** Below this, a margin-point difference is float noise rather than a
 *  position the evaluation actually scores differently. */
const TERM_EPS = 1e-6;

/** Below this, a basis component is noise from the derivative step rather
 *  than a unit the position holds (`features.ts` sizes that step so the noise
 *  stays orders of magnitude under it). */
const BASIS_EPS = 1e-6;

export type VerdictReport = {
    verdicts: number;
    rows: VerdictRow[];
    pairs: EvalPair[];
    satisfied: EvalPair[];
    violated: EvalPair[];
    contradictions: Contradiction[];
    /** Pairs the evaluation cannot separate at all — same fittable basis, same
     *  term breakdown, same policy value. A missing evaluation term (ADR 0124
     *  §3) and the identical-feature-vector proof §5 asks for. Always a subset
     *  of `violated`. */
    blind: EvalPair[];
    /** Entries that yielded no verdict at all, carried through from the
     *  source so one report answers "what was in, and what was left out". */
    gaps: VerdictGap[];
    /** Verdicts whose position could not be rebuilt or whose candidates no
     *  longer enumerate. */
    errors: { verdictId: string; error: string }[];
};

/** Canonical key of a basis delta's DIRECTION, for anti-parallel matching.
 *
 *  Normalised to unit length first, because the unsatisfiable-together
 *  relation is about direction, not magnitude: `w · v ≥ δ` and
 *  `w · (−2v) ≥ δ` are exactly as irreconcilable as `v` against `−v`, and
 *  keying the raw vectors would report the first couple and miss the second.
 *
 *  Rounded to 1e-6 afterwards so the derivative's float noise cannot split two
 *  identical directions; the derivative uses a power-of-two step precisely so
 *  that noise stays orders of magnitude below this (`features.ts`; the
 *  measured floor on today's corpus is 1e-9…1e-4 for a zero component against
 *  7.5e-2 for the smallest real one). It is grid rounding rather than a
 *  tolerance, so two directions 7e-7 apart CAN straddle a boundary and fail to
 *  match — harmless at this corpus size, and the thing to replace with
 *  tolerance-based clustering when the corpus grows past hand-reading. */
export function basisDirectionKey(
    basis: Record<FittableWeightKey, number>,
    sign: 1 | -1
): string {
    let norm = 0;
    for (const k of FITTABLE_WEIGHT_KEYS) norm += basis[k] ** 2;
    norm = Math.sqrt(norm) || 1;
    return FITTABLE_WEIGHT_KEYS.map((k) =>
        // `+ 0` normalises the negative zero `-1 * 0` produces, which would
        // otherwise stringify as "-0" and never match its own positive twin.
        (Math.round((sign * basis[k] * 1e6) / norm) / 1e6 + 0).toString()
    ).join("|");
}

function basisKey(pair: EvalPair, sign: 1 | -1): string {
    return basisDirectionKey(pair.basis, sign);
}

/** Every couple of pairs no weight vector can satisfy together: their basis
 *  directions are exact negatives, so `w · v ≥ δ` and `w · (−v) ≥ δ` are
 *  irreconcilable for every `w`. Indexed by the positive key — a pair
 *  contradicts another when its NEGATED key is already present — so each
 *  unordered couple is reported once.
 *
 *  BLIND pairs are held out: the zero vector is its own negation, so N of
 *  them read as N² false disagreements (measured: 492 before the split, 53
 *  after). Exported because the Weight Fit (issue #3401) reports the same
 *  relation over the pairs it was handed, and two copies of this scan would
 *  drift the first time the holdout rule changed. */
export function contradictoryCouples(
    pairs: readonly EvalPair[]
): Contradiction[] {
    const byKey = new Map<string, EvalPair[]>();
    const out: Contradiction[] = [];
    for (const pair of pairs) {
        if (isBlind(pair)) continue;
        const opposite = byKey.get(basisKey(pair, -1));
        if (opposite) for (const a of opposite) out.push({ a, b: pair });
        const key = basisKey(pair, 1);
        const bucket = byKey.get(key);
        if (bucket) bucket.push(pair);
        else byKey.set(key, [pair]);
    }
    return out;
}

/** Walk every verdict, build its pairs, and classify. `onRow` fires as each
 *  verdict completes so a long run can stream progress. */
export function collectVerdictReport(
    verdicts: readonly Verdict[],
    options: {
        weights?: EvalWeights;
        gaps?: VerdictGap[];
        onRow?: (row: VerdictRow) => void;
    } = {}
): VerdictReport {
    const weights = options.weights ?? DEFAULT_EVAL_WEIGHTS;
    const rows: VerdictRow[] = [];
    const pairs: EvalPair[] = [];
    const errors: VerdictReport["errors"] = [];

    for (const verdict of verdicts) {
        const out = evalPairsOf(verdict, weights);
        const violated = out.pairs.filter((p) => p.delta <= SATISFIED_EPS);
        const row: VerdictRow = {
            verdictId: verdict.id,
            kind: verdict.answer.kind,
            candidates: verdict.candidates.length,
            pairs: out.pairs.length,
            violated: violated.length,
            ok: out.error === undefined && violated.length === 0,
            ...(out.error ? { error: out.error } : {}),
        };
        if (out.error) errors.push({ verdictId: verdict.id, error: out.error });
        pairs.push(...out.pairs);
        rows.push(row);
        options.onRow?.(row);
    }

    const satisfied = pairs.filter((p) => p.delta > SATISFIED_EPS);
    const violated = pairs.filter((p) => p.delta <= SATISFIED_EPS);

    const blind = pairs.filter(isBlind);
    const contradictions = contradictoryCouples(pairs);

    return {
        verdicts: verdicts.length,
        rows,
        pairs,
        satisfied,
        violated,
        contradictions,
        blind,
        gaps: options.gaps ?? [],
        errors,
    };
}

function pct(n: number, d: number): string {
    return d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`;
}

/** The term deltas that actually moved, biggest first — the actionable half of
 *  a violated pair. */
function termDeltaLine(pair: EvalPair): string {
    const moved = EVAL_TERM_KEYS.map((k) => [k, pair.terms[k]] as const)
        .filter(([, v]) => Math.abs(v) >= 0.5)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (moved.length === 0) return "no term moved (identical positions)";
    return moved
        .map(([k, v]) => `${k} ${v >= 0 ? "+" : ""}${v.toFixed(1)}`)
        .join(", ");
}

/** One line per verdict, the shape a streaming runner prints. */
export function formatVerdictRow(row: VerdictRow): string {
    const state = row.error ? "ERR " : row.ok ? "ok  " : "FAIL";
    const tail = row.error
        ? `  ${row.error}`
        : `  ${row.pairs - row.violated}/${row.pairs} pairs`;
    return `[${row.kind.padEnd(9)}] ${state}${tail}  ${row.verdictId}`;
}

export function formatVerdictReport(
    report: VerdictReport,
    elapsedMs: number
): string {
    const out: string[] = [];
    const ok = report.rows.filter((r) => r.ok).length;
    out.push(
        `== Eval Pairs vs the current weights (issue #3400) — ${report.verdicts} verdicts, ${report.pairs.length} pairs, ${(elapsedMs / 1000).toFixed(1)}s`
    );
    out.push(
        `  verdicts fully ordered : ${ok}/${report.rows.length} (${pct(ok, report.rows.length)})`
    );
    out.push(
        `  pairs satisfied        : ${report.satisfied.length}/${report.pairs.length} (${pct(report.satisfied.length, report.pairs.length)})`
    );
    out.push(`  pairs violated         : ${report.violated.length}`);
    out.push(`  contradictory pairs    : ${report.contradictions.length}`);
    out.push(
        `  blind pairs            : ${report.blind.length} (identical feature vectors — a missing term)`
    );
    out.push(`  verdicts in error      : ${report.errors.length}`);

    const byKind = (k: "right" | "forbidden") => {
        const rows = report.rows.filter((r) => r.kind === k);
        return `${rows.filter((r) => r.ok).length}/${rows.length}`;
    };
    out.push(
        `  by answer kind         : right ${byKind("right")}, forbidden ${byKind("forbidden")}`
    );

    out.push(
        `\n== verdicts the evaluation gets WRONG (${report.rows.filter((r) => !r.ok && !r.error).length})`
    );
    for (const row of report.rows) {
        if (row.ok || row.error) continue;
        out.push(`  ${row.verdictId}`);
        for (const pair of report.violated) {
            if (pair.verdictId !== row.verdictId) continue;
            out.push(
                `      want  ${pair.right.description}\n      over  ${pair.other.description}\n      Δ policy ${pair.delta.toFixed(1)} (fittable ${pair.fittableDelta.toFixed(1)})  |  ${termDeltaLine(pair)}`
            );
        }
    }

    if (report.contradictions.length > 0) {
        // One line per distinct VERDICT COUPLE: a position with several
        // equivalent candidates yields several pairs carrying the same
        // vector, and printing each would bury how many real disagreements
        // there are behind their multiplicity.
        const couples = new Map<
            string,
            { a: EvalPair; b: EvalPair; n: number }
        >();
        for (const { a, b } of report.contradictions) {
            const key = [a.verdictId, b.verdictId].sort().join(" \u21c4 ");
            const seen = couples.get(key);
            if (seen) seen.n++;
            else couples.set(key, { a, b, n: 1 });
        }
        out.push(
            `\n== CONTRADICTORY verdicts (${couples.size} couples, ${report.contradictions.length} pairs) — identical feature vectors, opposite order`
        );
        for (const { a, b, n } of couples.values()) {
            out.push(
                `  ${a.verdictId}: ${a.right.description} > ${a.other.description}\n  ${b.verdictId}: ${b.right.description} > ${b.other.description}${n > 1 ? `\n      (and ${n - 1} further pair${n === 2 ? "" : "s"} with the same vector)` : ""}`
            );
        }
    }

    if (report.blind.length > 0) {
        out.push(
            `\n== BLIND pairs (${report.blind.length}) — the evaluation cannot separate the two candidates at all`
        );
        for (const pair of report.blind) {
            out.push(
                `  ${pair.verdictId}\n      want  ${pair.right.description}\n      over  ${pair.other.description}`
            );
        }
    }

    if (report.errors.length > 0) {
        out.push(`\n== verdicts in ERROR (${report.errors.length})`);
        for (const e of report.errors) out.push(`  ${e.verdictId}: ${e.error}`);
    }

    if (report.gaps.length > 0) {
        const byReason = new Map<string, VerdictGap[]>();
        for (const gap of report.gaps) {
            const bucket = byReason.get(gap.reason);
            if (bucket) bucket.push(gap);
            else byReason.set(gap.reason, [gap]);
        }
        out.push(
            `\n== sources that yielded NO verdict (${report.gaps.length})`
        );
        for (const [reason, gaps] of byReason) {
            out.push(`  ${reason} (${gaps.length})`);
            for (const gap of gaps)
                out.push(`      [${gap.tier}] ${gap.label} — ${gap.detail}`);
        }
    }
    return out.join("\n");
}
