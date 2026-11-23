/**
 * Rollout width — how many candidates the rollout's greedy default policy
 * probes per ply (issue #10631).
 *
 * A PROBING ply is one where `selectRolloutMove` clones, applies and
 * evaluates every candidate (the greedy branch of `rollout`; the epsilon
 * draw and the forced pass probe nothing). Its width is the number of
 * candidates it probed. A DECLARATION ply is a probing ply whose candidates
 * hold an attack or a block declaration.
 *
 * The same counters as `docs/research/scripts/brain-bench/rollout-policies.mjs`
 * (`greedyPicks`, `greedyCandidates`), read here without patching a bundle:
 * `search.ts` calls an installed recorder (`setRolloutPlyRecorder`) and this
 * module accumulates. A measurement, never an input: no decision reads it.
 *
 * Pure, no imports: `scripts/` reads the summaries through `census.ts`.
 */

/** Width counters of one or more searches. `hist` maps a candidate count to
 *  the probing plies that had it (string keys: it travels as JSON). */
export type RolloutWidth = {
    plies: number;
    candidates: number;
    declarationPlies: number;
    hist: Record<string, number>;
};

export type RolloutWidthSummary = {
    /** Probing plies counted. */
    plies: number;
    /** Candidates per probing ply. */
    mean: number;
    p50: number;
    p90: number;
    /** Share of probing plies that hold an attack or block declaration. */
    declarationShare: number;
};

export function newRolloutWidth(): RolloutWidth {
    return { plies: 0, candidates: 0, declarationPlies: 0, hist: {} };
}

/** Count one probing ply into `w`. */
export function recordRolloutPly(
    w: RolloutWidth,
    candidates: number,
    declaration: boolean
): void {
    w.plies += 1;
    w.candidates += candidates;
    if (declaration) w.declarationPlies += 1;
    const k = String(candidates);
    w.hist[k] = (w.hist[k] ?? 0) + 1;
}

/** The counters of several searches pooled. */
export function mergeRolloutWidth(
    parts: readonly (RolloutWidth | undefined)[]
): RolloutWidth {
    const out = newRolloutWidth();
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p) continue;
        out.plies += p.plies;
        out.candidates += p.candidates;
        out.declarationPlies += p.declarationPlies;
        const keys = Object.keys(p.hist);
        for (let j = 0; j < keys.length; j++) {
            const k = keys[j];
            out.hist[k] = (out.hist[k] ?? 0) + p.hist[k];
        }
    }
    return out;
}

/** Nearest-rank quantile of the histogram; 0 on an empty one. */
function histQuantile(w: RolloutWidth, q: number): number {
    if (w.plies === 0) return 0;
    const rank = Math.max(1, Math.ceil(q * w.plies));
    const sizes = Object.keys(w.hist)
        .map(Number)
        .sort((a, b) => a - b);
    let seen = 0;
    for (let i = 0; i < sizes.length; i++) {
        seen += w.hist[String(sizes[i])];
        if (seen >= rank) return sizes[i];
    }
    return sizes[sizes.length - 1];
}

export function summarizeRolloutWidth(w: RolloutWidth): RolloutWidthSummary {
    return {
        plies: w.plies,
        mean: w.plies === 0 ? 0 : w.candidates / w.plies,
        p50: histQuantile(w, 0.5),
        p90: histQuantile(w, 0.9),
        declarationShare: w.plies === 0 ? 0 : w.declarationPlies / w.plies,
    };
}

/** One printable line. */
export function formatRolloutWidth(s: RolloutWidthSummary): string {
    return (
        `candidates per probing ply mean ${s.mean.toFixed(2)}, p50 ${s.p50}, p90 ${s.p90}` +
        ` · declaration plies ${(100 * s.declarationShare).toFixed(0)}%` +
        ` · ${s.plies} probing plies`
    );
}
