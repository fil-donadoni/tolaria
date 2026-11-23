/**
 * `bun run blade:probe <label>` — the authoring check for ONE blade entry
 * (issue #10631), pure half: the legs it runs, their job list, and the table
 * it prints.
 *
 * A candidate entry is admitted to `must` when its answer is CLEAR, not when
 * it happens to pass the seeds it was written with. One run answers the
 * questions an author would otherwise ask one `blade:census` arm at a time:
 *
 *   - the pass count over N wide seeds (default 20) at the entry's budget,
 *     at half of it and at double — a position whose answer needs the full
 *     budget, or flips with more of it, is not clear;
 *   - the robustness audit's own classification (`classifyRobustness`, the
 *     legs of `auditBladeScenario`: the entry's own seeds, then the default
 *     and both jittered weight vectors over `ROBUSTNESS_SEEDS`), with the
 *     deciding root mechanism of every run;
 *   - the same pass count under a named search variant (`--variant`), so a
 *     discriminating pair reads "base N/N, variant 0/N" in one table;
 *   - the rollout width of the position (`../rolloutWidth`): candidates per
 *     probing ply and the share of declaration plies, read on the base runs
 *     at the entry's budget.
 *
 * Registry-free like `./census`: `scripts/blade-probe.ts` imports this module,
 * and the registry drags `lib.dom` into the `scripts` project. The worker
 * that reads the registry is `__tests__/probe.spec.ts`.
 *
 * Verdicts depend on iterations and seeds only (`ms` is reported, never read).
 */

import {
    formatRolloutWidth,
    mergeRolloutWidth,
    summarizeRolloutWidth,
    type RolloutWidth,
    type RolloutWidthSummary,
} from "../rolloutWidth";
import {
    ROBUSTNESS_SEEDS,
    classifyRobustness,
    type RobustnessVerdict,
} from "./robustnessClassify";

/** Wide seeds per budget leg unless `--seeds` says otherwise. */
export const PROBE_DEFAULT_SEEDS = 20;

/** The `must` admission bar of issue #10631: at least 19 of 20 wide seeds at
 *  the declared budget, scaled to `--seeds` (integer arithmetic). */
export const PROBE_ADMISSION = { passed: 19, of: 20 } as const;

/** The fewest passes of `seeds` runs that clear the admission bar. */
export function probeAdmissionFloor(seeds: number): number {
    return Math.ceil((PROBE_ADMISSION.passed * seeds) / PROBE_ADMISSION.of);
}

/** The variant names the worker resolves to the robustness audit's jittered
 *  vectors (`robustnessVectors()` in `./robustness`, by `variant.name`). */
export const PROBE_JITTER_VARIANTS = [
    "robustness:jitter+",
    "robustness:jitter-",
] as const;

/** What the probe reads of a blade entry. */
export type ProbeEntry = {
    label: string;
    tier: string;
    budget: { iterations: number };
    seeds?: number[];
};

/** The options of one probe, as `blade:probe` writes them for its workers. */
export type ProbeConfig = {
    label: string;
    /** Wide seeds per budget leg: `0 … seeds - 1`. */
    seeds: number;
    /** A `LADDER_VARIANTS` name or `no-rule:<mechanism>`. */
    variant?: string;
};

export type ProbeLegKey =
    | "own"
    | "half"
    | "declared"
    | "double"
    | "default"
    | "jitter+"
    | "jitter-"
    | "variant";

/** One row of the table: a budget, a variant, a seed list. */
export type ProbeLeg = {
    key: ProbeLegKey;
    title: string;
    /** `null` = production defaults. */
    variant: string | null;
    iterations: number;
    seeds: number[];
};

export type ProbeJob = {
    id: number;
    variant: string | null;
    iterations: number;
    seed: number;
    /** Record the rollout width (the declared-budget base runs only). */
    measureWidth: boolean;
};

export type ProbeRow = ProbeJob & {
    ok: boolean;
    move: string;
    mechanism: string | null;
    ms: number;
    width?: RolloutWidth;
};

/** The blade runner's default seed (`DEFAULT_BLADE_SEED`), copied for the
 *  reason `DEFAULT_CENSUS_SEED` is: this module cannot import the runner. */
const DEFAULT_PROBE_OWN_SEED = 0xb1ade;

function range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
}

/** The legs of one probe, in table order. */
export function planProbeLegs(
    entry: ProbeEntry,
    config: ProbeConfig
): ProbeLeg[] {
    if (!Number.isInteger(config.seeds) || config.seeds < 1) {
        throw new Error(`probe: --seeds must be a positive integer`);
    }
    const it = entry.budget.iterations;
    const wide = range(config.seeds);
    const robust = ROBUSTNESS_SEEDS.slice();
    const legs: ProbeLeg[] = [
        {
            key: "own",
            title: "own seeds",
            variant: null,
            iterations: it,
            seeds: entry.seeds ?? [DEFAULT_PROBE_OWN_SEED],
        },
        {
            key: "half",
            title: "base ½×",
            variant: null,
            iterations: Math.max(1, Math.round(it / 2)),
            seeds: wide,
        },
        {
            key: "declared",
            title: "base 1×",
            variant: null,
            iterations: it,
            seeds: wide,
        },
        {
            key: "double",
            title: "base 2×",
            variant: null,
            iterations: it * 2,
            seeds: wide,
        },
        {
            key: "default",
            title: "audit default",
            variant: null,
            iterations: it,
            seeds: robust,
        },
        {
            key: "jitter+",
            title: "audit jitter+",
            variant: PROBE_JITTER_VARIANTS[0],
            iterations: it,
            seeds: robust,
        },
        {
            key: "jitter-",
            title: "audit jitter-",
            variant: PROBE_JITTER_VARIANTS[1],
            iterations: it,
            seeds: robust,
        },
    ];
    if (config.variant) {
        legs.push({
            key: "variant",
            title: `variant ${config.variant} 1×`,
            variant: config.variant,
            iterations: it,
            seeds: wide,
        });
    }
    return legs;
}

function cellKey(variant: string | null, iterations: number, seed: number) {
    return `${variant ?? ""}\u0000${iterations}\u0000${seed}`;
}

/** One job per distinct (variant, budget, seed) cell of the legs — the audit
 *  default leg and the own seeds reuse the declared-budget base runs they
 *  share — costliest budgets first so the pool's tail is short. */
export function buildProbeJobs(legs: readonly ProbeLeg[]): ProbeJob[] {
    const cells = new Map<string, Omit<ProbeJob, "id">>();
    const declared = legs.find((l) => l.key === "declared");
    for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        for (let j = 0; j < leg.seeds.length; j++) {
            const seed = leg.seeds[j];
            const key = cellKey(leg.variant, leg.iterations, seed);
            const measureWidth =
                leg.variant === null &&
                declared !== undefined &&
                leg.iterations === declared.iterations;
            const known = cells.get(key);
            if (known) known.measureWidth = known.measureWidth || measureWidth;
            else
                cells.set(key, {
                    variant: leg.variant,
                    iterations: leg.iterations,
                    seed,
                    measureWidth,
                });
        }
    }
    return [...cells.values()]
        .map((c, i) => ({ c, i }))
        .sort((a, b) => b.c.iterations - a.c.iterations || a.i - b.i)
        .map(({ c }, id) => ({ id, ...c }));
}

export type ProbeLegResult = {
    leg: ProbeLeg;
    passed: number;
    seeds: number;
    /** Deciding root mechanism → runs it settled. */
    mechanisms: Record<string, number>;
    failures: { seed: number; move: string; mechanism: string | null }[];
};

export type ProbeReport = {
    label: string;
    tier: string;
    iterations: number;
    variant: string | null;
    sha: string | null;
    legs: ProbeLegResult[];
    robustness: RobustnessVerdict;
    width: RolloutWidthSummary;
    /** Search iterations of one run at the declared budget, and of the
     *  whole robustness audit for this entry (own seeds + three vectors over
     *  `ROBUSTNESS_SEEDS`): what the entry adds to the cost-balanced audit. */
    cost: { perRun: number; audit: number };
    /** `ROBUST` and the admission fraction of the wide seeds at 1×. */
    admitted: boolean;
};

/** Read the rows back into the table. Throws on a cell no row answers:
 *  a missing run is never read as a pass. */
export function summarizeProbe(
    entry: ProbeEntry,
    config: ProbeConfig,
    rows: readonly ProbeRow[],
    sha: string | null = null
): ProbeReport {
    const legs = planProbeLegs(entry, config);
    const byCell = new Map(
        rows.map((r) => [cellKey(r.variant, r.iterations, r.seed), r])
    );
    const results = legs.map((leg): ProbeLegResult => {
        const mechanisms: Record<string, number> = {};
        const failures: ProbeLegResult["failures"] = [];
        let passed = 0;
        for (let i = 0; i < leg.seeds.length; i++) {
            const seed = leg.seeds[i];
            const row = byCell.get(cellKey(leg.variant, leg.iterations, seed));
            if (!row) {
                throw new Error(
                    `probe: no row for ${leg.title} seed ${seed} @${leg.iterations}`
                );
            }
            const m = row.mechanism ?? "none";
            mechanisms[m] = (mechanisms[m] ?? 0) + 1;
            if (row.ok) passed++;
            else
                failures.push({
                    seed,
                    move: row.move,
                    mechanism: row.mechanism,
                });
        }
        return { leg, passed, seeds: leg.seeds.length, mechanisms, failures };
    });
    const pick = (k: ProbeLegKey) => results.find((r) => r.leg.key === k)!;
    const own = pick("own");
    const robustness = classifyRobustness(
        { seeds: own.seeds, passed: own.passed },
        [pick("default"), pick("jitter+"), pick("jitter-")]
    );
    const declared = pick("declared");
    const width = summarizeRolloutWidth(
        mergeRolloutWidth(
            rows
                .filter(
                    (r) =>
                        r.variant === null &&
                        r.iterations === entry.budget.iterations
                )
                .map((r) => r.width)
        )
    );
    const it = entry.budget.iterations;
    return {
        label: entry.label,
        tier: entry.tier,
        iterations: it,
        variant: config.variant ?? null,
        sha,
        legs: results,
        robustness,
        width,
        cost: {
            perRun: it,
            audit: it * (own.seeds + 3 * ROBUSTNESS_SEEDS.length),
        },
        admitted:
            robustness === "robust" &&
            declared.passed >= probeAdmissionFloor(declared.seeds),
    };
}

function formatMechanisms(m: Record<string, number>): string {
    return Object.entries(m)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([k, n]) => `${k}×${n}`)
        .join(", ");
}

/** The printed table. */
export function formatProbeReport(r: ProbeReport): string {
    const head =
        `blade:probe "${r.label}" tier=${r.tier} budget=${r.iterations}` +
        (r.variant ? ` variant=${r.variant}` : "") +
        (r.sha ? ` sha=${r.sha.slice(0, 10)}` : "");
    const titleW = Math.max(...r.legs.map((l) => l.leg.title.length));
    const rows = r.legs.map((l) => {
        const pass = `${l.passed}/${l.seeds}`.padStart(6);
        const it = String(l.leg.iterations).padStart(6);
        return `  ${l.leg.title.padEnd(titleW)}  ${it}  ${pass}  ${formatMechanisms(l.mechanisms)}`;
    });
    const failures = r.legs.flatMap((l) =>
        l.failures.map(
            (f) =>
                `  ✗ ${l.leg.title} seed ${f.seed}: ${f.move} [${f.mechanism ?? "none"}]`
        )
    );
    const declared = r.legs.find((l) => l.leg.key === "declared")!;
    return [
        head,
        `  ${"leg".padEnd(titleW)}  ${"iters".padStart(6)}  ${"pass".padStart(6)}  deciding mechanism`,
        ...rows,
        ...(failures.length > 0 ? ["failing runs:", ...failures] : []),
        `robustness: ${r.robustness.toUpperCase()}`,
        `rollout width (base 1×): ${formatRolloutWidth(r.width)}`,
        `cost: ${r.cost.perRun} iterations per run; ${r.cost.audit} in the robustness audit`,
        r.admitted
            ? `admission: must ✓ (ROBUST, ${declared.passed}/${declared.seeds} at 1×)`
            : `admission: not must — ${r.robustness.toUpperCase()}, ${declared.passed}/${declared.seeds} at 1× (needs ROBUST and ≥ ${probeAdmissionFloor(declared.seeds)}/${declared.seeds}); a clear-to-a-human entry goes to stretch, cause branching`,
    ].join("\n");
}
