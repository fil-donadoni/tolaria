/**
 * The blade flip census, pure half: the job list, its slices, the rows a run
 * writes, the merge of slices and the diff of two arms.
 *
 * A census arm runs every entry of a tier under one search variant. Its unit
 * of work is one (entry, seed) pair: a blade entry's seeds are independent
 * searches, so a pool of workers claiming pairs from one list finishes in
 * total work / workers, where the fixed-shard suite (`shard.ts`) waits for
 * its slowest shard.
 *
 * Deliberately free of the registry and of `./types`: importing either pulls
 * `convex/game.ts` and with it `lib.dom` into the `scripts` tsconfig project,
 * and `scripts/blade-census.ts` imports this module. The runner that reads the
 * real registry is `__tests__/census.spec.ts`; it hands entries in through the
 * structural `CensusEntry`.
 *
 * Verdicts depend on `iterations` and seeds only. `ms` is reported for
 * planning, never asserted.
 */

/** What the job list reads of a blade entry. */
export type CensusEntry = {
    label: string;
    tier: string;
    budget: { iterations: number };
    seeds?: number[];
};

/** The options of one census arm, as `blade:census` writes them for its
 *  workers (`config.json` in the work directory). */
export type CensusConfig = {
    tier: "must" | "stretch";
    /** A `LADDER_VARIANTS` name or `no-rule:<mechanism>`; absent = base. */
    variant?: string;
    /** A JS regular expression matched against the label. */
    match?: string;
    /** Exact labels; an unknown label is an error, never silently dropped. */
    entries?: string[];
    /** Overrides every entry's declared budget (a budget sweep). */
    iterations?: number;
    /** After an entry's first red seed, its remaining seeds are skipped. */
    failFast?: boolean;
    /** 1-based static slice of the job list: `{ index: 2, count: 8 }`. */
    slice?: { index: number; count: number };
};

export type CensusJob = {
    /** Position in the full (unsliced) job list: stable across slices. */
    id: number;
    label: string;
    seed: number;
    iterations: number;
};

export type CensusRow = CensusJob & {
    ok: boolean;
    /** Skipped by `failFast` after an earlier red seed of the same entry. */
    skipped?: boolean;
    move: string;
    reason: string;
    mechanism: string | null;
    ms: number;
};

export type CensusMeta = {
    tier: string;
    variant: string | null;
    match: string | null;
    iterations: number | null;
    failFast: boolean;
    slices: string[];
    jobs: number;
    wallMs: number;
    cpuMs: number;
    workers: number;
    sha: string | null;
};

export type CensusResult = { meta: CensusMeta; rows: CensusRow[] };

/** The blade runner's default seed list, for an entry that declares none. */
export const DEFAULT_CENSUS_SEED = 0xb1ade;

/** Parse `--slice i/n` (1-based). */
export function parseSlice(spec: string): { index: number; count: number } {
    const m = /^(\d+)\/(\d+)$/.exec(spec.trim());
    if (!m) throw new Error(`slice "${spec}" is not i/n`);
    const index = Number(m[1]);
    const count = Number(m[2]);
    if (count < 1 || index < 1 || index > count) {
        throw new Error(`slice "${spec}" needs 1 <= i <= n`);
    }
    return { index, count };
}

/** The entries of `scenarios` the config selects, in registry order. Throws
 *  on a label in `entries` the tier does not hold. */
export function selectCensusEntries<E extends CensusEntry>(
    scenarios: readonly E[],
    config: CensusConfig
): E[] {
    let selected = scenarios.filter((s) => s.tier === config.tier);
    if (config.entries) {
        const byLabel = new Map(selected.map((s) => [s.label, s]));
        const missing = config.entries.filter((l) => !byLabel.has(l));
        if (missing.length > 0) {
            throw new Error(
                `census: no ${config.tier} entry labelled ${missing.map((l) => JSON.stringify(l)).join(", ")}`
            );
        }
        const wanted = new Set(config.entries);
        selected = selected.filter((s) => wanted.has(s.label));
    }
    if (config.match) {
        const re = new RegExp(config.match);
        selected = selected.filter((s) => re.test(s.label));
    }
    return selected;
}

/** The full job list: one job per (entry, seed), the costliest budgets first
 *  so the pool's tail is short (longest-processing-time order; the budget is
 *  the only cost known before running). Ids follow that order. */
export function buildCensusJobs(
    entries: readonly CensusEntry[],
    config: CensusConfig
): CensusJob[] {
    const jobs: Omit<CensusJob, "id">[] = [];
    for (const e of entries) {
        const iterations = config.iterations ?? e.budget.iterations;
        for (const seed of e.seeds ?? [DEFAULT_CENSUS_SEED]) {
            jobs.push({ label: e.label, seed, iterations });
        }
    }
    // Stable sort: equal budgets keep registry order.
    const ordered = jobs
        .map((j, i) => ({ j, i }))
        .sort((a, b) => b.j.iterations - a.j.iterations || a.i - b.i)
        .map(({ j }) => j);
    return ordered.map((j, id) => ({ id, ...j }));
}

/** The jobs of one static slice: ids congruent to `index - 1` modulo
 *  `count`, so every slice gets a share of the costly head. */
export function sliceCensusJobs(
    jobs: readonly CensusJob[],
    slice: { index: number; count: number } | undefined
): CensusJob[] {
    if (!slice) return [...jobs];
    return jobs.filter((j) => j.id % slice.count === slice.index - 1);
}

/** One entry's verdict across its rows: red when any seed is red. */
export type CensusEntryVerdict = {
    label: string;
    iterations: number;
    ok: boolean;
    redSeeds: number[];
    moves: string[];
    ms: number;
};

/** Group rows by (label, iterations), registry-agnostic. */
export function censusVerdicts(
    rows: readonly CensusRow[]
): CensusEntryVerdict[] {
    const byKey = new Map<string, CensusEntryVerdict>();
    for (const r of [...rows].sort((a, b) => a.id - b.id)) {
        const key = `${r.label}\u0000${r.iterations}`;
        let v = byKey.get(key);
        if (!v) {
            v = {
                label: r.label,
                iterations: r.iterations,
                ok: true,
                redSeeds: [],
                moves: [],
                ms: 0,
            };
            byKey.set(key, v);
        }
        v.ms += r.ms;
        // A fail-fast skip is written `ok: true`: it never reds the entry.
        if (!r.ok) {
            v.ok = false;
            v.redSeeds.push(r.seed);
            v.moves.push(`seed ${r.seed}: ${r.move}`);
        }
    }
    return [...byKey.values()];
}

/** Merge slice results into one arm. Throws when two slices hold the same
 *  job id or disagree on the arm (tier, variant, budget override). */
export function mergeCensusResults(
    parts: readonly CensusResult[]
): CensusResult {
    if (parts.length === 0) throw new Error("census merge: no input");
    const [first] = parts;
    const seen = new Set<number>();
    const rows: CensusRow[] = [];
    for (const p of parts) {
        for (const field of [
            "tier",
            "variant",
            "iterations",
            "match",
        ] as const) {
            if (p.meta[field] !== first.meta[field]) {
                throw new Error(
                    `census merge: slices disagree on ${field} (${String(first.meta[field])} vs ${String(p.meta[field])})`
                );
            }
        }
        for (const r of p.rows) {
            if (seen.has(r.id)) {
                throw new Error(`census merge: job ${r.id} appears twice`);
            }
            seen.add(r.id);
            rows.push(r);
        }
    }
    rows.sort((a, b) => a.id - b.id);
    return {
        meta: {
            ...first.meta,
            slices: parts.flatMap((p) => p.meta.slices),
            jobs: parts.reduce((n, p) => n + p.meta.jobs, 0),
            wallMs: Math.max(...parts.map((p) => p.meta.wallMs)),
            cpuMs: parts.reduce((n, p) => n + p.meta.cpuMs, 0),
            workers: parts.reduce((n, p) => n + p.meta.workers, 0),
        },
        rows,
    };
}

export type CensusFlip = {
    label: string;
    iterations: number;
    redSeeds: number[];
    moves: string[];
};

export type CensusDiff = {
    /** Green in the base arm, red in the variant: the census's answer. */
    newReds: CensusFlip[];
    /** Red in the base arm, green in the variant. */
    fixed: CensusFlip[];
    /** Red in both. */
    stillRed: CensusFlip[];
    /** Entries only one arm ran (a different selection): never compared. */
    unmatched: string[];
};

/** The flips between a base arm and a variant arm, by (label, iterations). */
export function diffCensus(
    base: CensusResult,
    variant: CensusResult
): CensusDiff {
    const key = (v: CensusEntryVerdict) => `${v.label}\u0000${v.iterations}`;
    const baseBy = new Map(censusVerdicts(base.rows).map((v) => [key(v), v]));
    const varBy = new Map(censusVerdicts(variant.rows).map((v) => [key(v), v]));
    const diff: CensusDiff = {
        newReds: [],
        fixed: [],
        stillRed: [],
        unmatched: [],
    };
    const flip = (v: CensusEntryVerdict): CensusFlip => ({
        label: v.label,
        iterations: v.iterations,
        redSeeds: v.redSeeds,
        moves: v.moves,
    });
    for (const [k, v] of varBy) {
        const b = baseBy.get(k);
        if (!b) {
            diff.unmatched.push(`${v.label} @${v.iterations}`);
            continue;
        }
        if (b.ok && !v.ok) diff.newReds.push(flip(v));
        else if (!b.ok && v.ok) diff.fixed.push(flip(b));
        else if (!b.ok && !v.ok) diff.stillRed.push(flip(v));
    }
    for (const [k, b] of baseBy) {
        if (!varBy.has(k)) diff.unmatched.push(`${b.label} @${b.iterations}`);
    }
    return diff;
}

function formatMs(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 120
        ? `${s}s`
        : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** The human summary of one arm: totals, timing, every red entry. */
export function formatCensusSummary(result: CensusResult): string {
    const verdicts = censusVerdicts(result.rows);
    const red = verdicts.filter((v) => !v.ok);
    const redSeeds = red.reduce((n, v) => n + v.redSeeds.length, 0);
    const m = result.meta;
    const lines = [
        `blade:census tier=${m.tier} variant=${m.variant ?? "base"}` +
            (m.iterations ? ` iterations=${m.iterations}` : "") +
            (m.match ? ` match=/${m.match}/` : "") +
            (m.failFast ? " fail-fast" : "") +
            (m.sha ? ` sha=${m.sha.slice(0, 10)}` : ""),
        `entries ${verdicts.length}, jobs ${result.rows.length}, red entries ${red.length} (${redSeeds} seeds)`,
        `wall ${formatMs(m.wallMs)}, cpu ${formatMs(m.cpuMs)}, workers ${m.workers}`,
    ];
    for (const v of red) {
        lines.push(`  RED ${v.label} @${v.iterations} — ${v.moves.join("; ")}`);
    }
    return lines.join("\n");
}

/** The human rendering of a diff, new reds first. */
export function formatCensusDiff(diff: CensusDiff): string {
    const section = (title: string, flips: CensusFlip[]) =>
        flips.length === 0
            ? []
            : [
                  `${title} (${flips.length}):`,
                  ...flips.map(
                      (f) =>
                          `  ${f.label} @${f.iterations} — ${f.redSeeds.length} seeds: ${f.moves.join("; ")}`
                  ),
              ];
    const newSeeds = diff.newReds.reduce((n, f) => n + f.redSeeds.length, 0);
    return [
        `new reds ${diff.newReds.length} (${newSeeds} seeds), fixed ${diff.fixed.length}, still red ${diff.stillRed.length}, unmatched ${diff.unmatched.length}`,
        ...section("NEW RED (green in base)", diff.newReds),
        ...section("FIXED (red in base)", diff.fixed),
        ...section("STILL RED", diff.stillRed),
        ...(diff.unmatched.length
            ? [`unmatched (run by one arm only): ${diff.unmatched.join("; ")}`]
            : []),
    ].join("\n");
}
