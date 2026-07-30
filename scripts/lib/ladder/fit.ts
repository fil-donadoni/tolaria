// Margin → win-probability calibration fit (issue #1929, map #1892 step 3).
//
// Pure module (no fs, no clock, no engine imports) so the fit is testable in
// the application suite and byte-deterministic: same corpus in → identical
// fitted constant out, always.
//
// Model: P(S0 wins | margin m) = σ(k·m), a one-parameter logistic in the
// `evaluate` margin (docs/research/mcts-small-budget-strength.md — logistic in
// margin is the default; isotonic only if the calibration curve rejects it).
// The intercept is pinned to 0 by construction: the corpus is symmetrically
// augmented — every sample (m, y) also contributes (−m, 1−y) — which encodes
// the true symmetry of the game (a margin of +X for S0 is a margin of −X for
// S1) and makes σ(0) = 0.5 exact rather than estimated.

import type { LadderGameRecord, LadderRunHeader } from "./plan";

export type CalibrationSample = {
    /** `evaluate` margin from S0's perspective at a turn boundary. */
    margin: number;
    /** 1 = S0 went on to win this game, 0 = S0 lost. */
    win: 0 | 1;
    turn: number;
};

/** Flatten run records into (margin, outcome) calibration samples.
 *
 *  Two exclusions keep the corpus honest:
 *  * guard-stop games (candidateWon === null) have no outcome label;
 *  * in a NULL run (variant === null) the two orientations of a pair are the
 *    IDENTICAL game bit-for-bit (same seed, same seating, both seats control),
 *    so keeping both would duplicate every sample — orientation 0 only. A
 *    variant run's orientations are genuinely different games; both count. */
export function extractCalibrationSamples(
    header: LadderRunHeader,
    records: LadderGameRecord[]
): CalibrationSample[] {
    const out: CalibrationSample[] = [];
    for (const r of records) {
        if (r.candidateWon === null || r.winnerSeat === null) continue;
        if (header.variant === null && r.orientation !== 0) continue;
        const win = r.winnerSeat === "S0" ? 1 : 0;
        for (const s of r.marginSamples ?? []) {
            out.push({ margin: s.margin, win, turn: s.turn });
        }
    }
    return out;
}

function sigma(x: number): number {
    // Guard the exp overflow ends; 1/(1+e^700) underflows to 0 anyway.
    if (x > 700) return 1;
    if (x < -700) return 0;
    return 1 / (1 + Math.exp(-x));
}

export type LogisticFit = {
    /** Fitted slope: P(S0 win) = σ(k·margin). */
    k: number;
    /** Newton steps actually taken (diagnostic; capped). */
    steps: number;
    /** Mean negative log-likelihood of the fit on the (augmented) corpus. */
    logLoss: number;
    /** Augmented sample count the fit ran on (2× the input). */
    n: number;
};

const NEWTON_MAX_STEPS = 60;
const NEWTON_TOL = 1e-14;

/** One-parameter logistic MLE by Newton–Raphson on the symmetrically augmented
 *  corpus. Deterministic: fixed start, fixed tolerance, fixed max steps —
 *  bit-identical output for identical input. */
export function fitLogisticSlope(samples: CalibrationSample[]): LogisticFit {
    if (samples.length === 0) throw new Error("empty calibration corpus");
    // Symmetric augmentation (see module header).
    const m: number[] = [];
    const y: number[] = [];
    for (const s of samples) {
        m.push(s.margin);
        y.push(s.win);
        m.push(-s.margin);
        y.push(1 - s.win);
    }

    let k = 1e-3; // order of the current linear slope — a sane, fixed start
    let steps = 0;
    for (; steps < NEWTON_MAX_STEPS; steps++) {
        let grad = 0;
        let hess = 0;
        for (let i = 0; i < m.length; i++) {
            const p = sigma(k * m[i]);
            grad += m[i] * (y[i] - p);
            hess += m[i] * m[i] * p * (1 - p);
        }
        if (hess === 0) break; // degenerate corpus (all margins 0)
        const delta = grad / hess;
        k += delta;
        if (Math.abs(delta) < NEWTON_TOL) {
            steps++;
            break;
        }
    }

    let nll = 0;
    for (let i = 0; i < m.length; i++) {
        const p = sigma(k * m[i]);
        // Clamp away exact 0/1 so a saturated sample can't produce Infinity.
        const q = Math.min(1 - 1e-15, Math.max(1e-15, p));
        nll -= y[i] === 1 ? Math.log(q) : Math.log(1 - q);
    }
    return { k, steps, logLoss: nll / m.length, n: m.length };
}

export type CalibrationBin = {
    lo: number;
    hi: number;
    n: number;
    /** Empirical S0 win rate of the samples in the bin. */
    empirical: number;
    /** Fitted σ(k·m) at the bin's sample-mean margin. */
    fitted: number;
};

/** Empirical-vs-fitted win rate per margin band — the calibration curve that
 *  decides whether the logistic is adequate (research: check before shipping;
 *  a systematic empirical/fitted gap is the isotonic-fit signal). */
export function calibrationTable(
    samples: CalibrationSample[],
    k: number,
    edges: number[]
): CalibrationBin[] {
    const bins: CalibrationBin[] = [];
    for (let i = 0; i < edges.length - 1; i++) {
        const inBin = samples.filter(
            (s) => s.margin >= edges[i] && s.margin < edges[i + 1]
        );
        if (inBin.length === 0) {
            bins.push({
                lo: edges[i],
                hi: edges[i + 1],
                n: 0,
                empirical: NaN,
                fitted: NaN,
            });
            continue;
        }
        const wins = inBin.reduce((a, s) => a + s.win, 0);
        const meanMargin =
            inBin.reduce((a, s) => a + s.margin, 0) / inBin.length;
        bins.push({
            lo: edges[i],
            hi: edges[i + 1],
            n: inBin.length,
            empirical: wins / inBin.length,
            fitted: sigma(k * meanMargin),
        });
    }
    return bins;
}
