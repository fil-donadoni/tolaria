/**
 * The four workflow KPIs (issue #4968) — pure over plain rows.
 *
 * The 2026-10-02 audit found two weeks of regressions (29% failed lands, the
 * base RED ~40% of a week, 7.5 health runs a day) sitting in data nobody was
 * reading: `telemetry.db` had not been ingested since 2026-09-17. `land` now
 * ingests after every merge, and this module turns what it ingested into four
 * numbers per window:
 *
 *   failed lands   — share of `land` attempts whose run was not green, split by
 *                    the stage that failed (`classifyLandFailure`)
 *   base RED       — hours between a RED health verdict and the next GREEN
 *   health runs    — tips gated per day
 *   mutex wait     — p50 / p90 of the heavy mutex wait (`gate-lock.jsonl`)
 *
 * Each is compared against its ceiling in `tolaria.config.json` § `workflow`;
 * `bun run workflow:kpi` exits non-zero on any breach, and `health-cadence`
 * prints the same lines when it fires.
 *
 * PURE so it runs under the `node` vitest project — `bun:sqlite` lives in the
 * CLI (`scripts/workflow-kpi.ts`), the same split `telemetry-latency` uses.
 */

import { readFileSync } from "node:fs";
import { CONFIG_PATH } from "./branches.ts";

/** The stage a non-green `land` stopped in. */
export type LandBucket =
    | "rebase"
    | "static"
    | "vitest"
    | "merge"
    | "refused"
    | "infra"
    | "other";

export const LAND_BUCKETS: readonly LandBucket[] = [
    "rebase",
    "static",
    "vitest",
    "merge",
    "refused",
    "infra",
    "other",
];

// A vitest failure line (`FAIL  |node-engine| path > test`), a summary that
// counts failed files, or the lane's own row for a vitest project.
const VITEST_FAILED =
    /^\s*FAIL\s+\|[\w-]+\||Test Files\s+\d+ failed|✗ (?:node|node-engine|node-tooling|dom|bot|blade|test[\w:-]*)\s/m;

/**
 * Which stage a non-green `land` log stopped in. Ordered by the order `land`
 * runs them — rebase, lane gate, push + merge — so the FIRST stage that left a
 * failure mark is the one charged:
 *
 *  - `refused` — `land` refused before queuing (`land: refusing — …`: RED
 *    base without `--red-ok`, run from the base branch, …);
 *  - `infra`  — the machine stayed saturated (issue #4966) or the run was
 *    killed by a signal: no verdict on the PR;
 *  - `rebase` — the rebase onto the base stopped (`Could not apply`,
 *    `CONFLICT`) before any lane ran;
 *  - `vitest` / `static` — the lane gate (`check:lane`, or the preflight that
 *    runs the same plan) failed; `vitest` when a test project failed, `static`
 *    for everything else it runs (format, lint, tsc, guards, cr:lint, …);
 *  - `merge`  — the lane passed and the push / `pr-merge` / merge
 *    verification did not;
 *  - `other`  — none of the above marks (e.g. a land refused before its gate).
 */
export function classifyLandFailure(log: string): LandBucket {
    if (/^(?:\S*)land: refusing — /m.test(log)) return "refused";
    if (
        /NOT landed, and NOT failed|exited with code 77\b|terminated by signal/.test(
            log
        )
    )
        return "infra";
    const laneRan = /^lane: (?:ran|skipped)/m.test(log);
    if (
        !laneRan &&
        /^(?:error: )?could not apply |^CONFLICT \(|^Could not apply /im.test(
            log
        )
    )
        return "rebase";
    const laneFailed =
        /error: script "check:lane" exited with code [1-9]/.test(log) ||
        /preflight is red on the PR.s own head/.test(log);
    if (laneFailed) return VITEST_FAILED.test(log) ? "vitest" : "static";
    if (laneRan || /pr-merge/.test(log)) return "merge";
    return "other";
}

/**
 * Did this `land` log reach a merge? A run can merge and still leave no
 * `green` marker (the teardown removed the cwd the marker is written from,
 * issue #4974), and a merged PR is not a failed land.
 */
export function landLogMerged(log: string): boolean {
    return /^pr-merge: PR #\d+ (?:is )?merged\b/m.test(log);
}

/** One `land` attempt: a run of `gate-run.sh land <PR#>`. */
export interface LandAttempt {
    /** Epoch seconds the attempt started. */
    started: number;
    green: boolean;
    /** NULL for green attempts and for rows whose log was never kept. */
    bucket: LandBucket | null;
}

/** One health verdict on a tip (`health_runs`). */
export interface HealthVerdict {
    /** Epoch seconds the verdict was written. */
    ts: number;
    red: boolean;
}

/** One heavy-mutex acquisition (`gate-lock.jsonl`). */
export interface MutexWait {
    ts: number;
    waitedMs: number;
}

export interface KpiWindow {
    /** Epoch seconds, inclusive. */
    from: number;
    /** Epoch seconds, exclusive. */
    to: number;
}

export interface WorkflowKpis {
    window: KpiWindow;
    lands: number;
    failed: number;
    failedPct: number;
    byBucket: Record<LandBucket | "unknown", number>;
    redHours: number;
    healthRuns: number;
    healthRed: number;
    healthRunsPerDay: number;
    waits: number;
    waitP50S: number | null;
    waitP90S: number | null;
}

function percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
    return sorted[Math.max(0, i)];
}

/**
 * Hours inside `w` during which the base was RED: from each RED verdict to
 * the next GREEN one (a RED that is never followed by a GREEN stays RED to
 * the window's end). A verdict before the window seeds the state it opens in.
 */
export function redHours(verdicts: HealthVerdict[], w: KpiWindow): number {
    const sorted = [...verdicts].sort((a, b) => a.ts - b.ts);
    let red = false;
    let since = w.from;
    let total = 0;
    for (const v of sorted) {
        if (v.ts >= w.to) break;
        const at = Math.max(v.ts, w.from);
        if (red && !v.red) total += at - since;
        if (!red && v.red) since = at;
        red = v.red;
    }
    if (red) total += w.to - since;
    return total / 3600;
}

export function computeWorkflowKpis(
    input: {
        lands: LandAttempt[];
        health: HealthVerdict[];
        waits: MutexWait[];
    },
    w: KpiWindow
): WorkflowKpis {
    const inW = (ts: number) => ts >= w.from && ts < w.to;
    const lands = input.lands.filter((l) => inW(l.started));
    const failedRows = lands.filter((l) => !l.green);
    const byBucket = Object.fromEntries(
        [...LAND_BUCKETS, "unknown"].map((b) => [b, 0])
    ) as WorkflowKpis["byBucket"];
    for (const l of failedRows) byBucket[l.bucket ?? "unknown"]++;

    const health = input.health.filter((h) => inW(h.ts));
    const days = (w.to - w.from) / 86400;
    const waits = input.waits
        .filter((x) => inW(x.ts))
        .map((x) => x.waitedMs / 1000)
        .sort((a, b) => a - b);

    return {
        window: w,
        lands: lands.length,
        failed: failedRows.length,
        failedPct: lands.length ? (100 * failedRows.length) / lands.length : 0,
        byBucket,
        redHours: redHours(input.health, w),
        healthRuns: health.length,
        healthRed: health.filter((h) => h.red).length,
        healthRunsPerDay: days > 0 ? health.length / days : 0,
        waits: waits.length,
        waitP50S: percentile(waits, 0.5),
        waitP90S: percentile(waits, 0.9),
    };
}

// ── thresholds ──────────────────────────────────────────────────────────────

/** Ceilings, all RATES so one value serves the 7- and the 14-day window. */
export interface KpiThresholds {
    failedLandPctMax: number;
    redHoursPerDayMax: number;
    healthRunsPerDayMax: number;
    mutexWaitP90SMax: number;
}

const THRESHOLD_KEYS = [
    "failedLandPctMax",
    "redHoursPerDayMax",
    "healthRunsPerDayMax",
    "mutexWaitP90SMax",
] as const;

export function parseKpiThresholds(
    raw: string,
    source = CONFIG_PATH
): KpiThresholds {
    const doc = JSON.parse(raw) as { workflow?: Record<string, unknown> };
    const block = doc.workflow;
    if (!block || typeof block !== "object")
        throw new Error(`${source}: missing "workflow" object`);
    const out = {} as KpiThresholds;
    for (const key of THRESHOLD_KEYS) {
        const v = block[key];
        if (typeof v !== "number" || !Number.isFinite(v) || v <= 0)
            throw new Error(
                `${source}: workflow.${key} must be a positive number, got ${JSON.stringify(v)}`
            );
        out[key] = v;
    }
    return out;
}

export function readKpiThresholds(path = CONFIG_PATH): KpiThresholds {
    return parseKpiThresholds(readFileSync(path, "utf8"), path);
}

/** Every KPI over its ceiling, as a one-line reason each. */
export function kpiBreaches(k: WorkflowKpis, t: KpiThresholds): string[] {
    const days = (k.window.to - k.window.from) / 86400;
    const out: string[] = [];
    if (k.lands > 0 && k.failedPct > t.failedLandPctMax)
        out.push(
            `failed lands ${k.failedPct.toFixed(1)}% > ${t.failedLandPctMax}%`
        );
    if (days > 0 && k.redHours / days > t.redHoursPerDayMax)
        out.push(
            `base RED ${(k.redHours / days).toFixed(1)} h/day > ${t.redHoursPerDayMax} h/day`
        );
    if (k.healthRunsPerDay > t.healthRunsPerDayMax)
        out.push(
            `health runs ${k.healthRunsPerDay.toFixed(1)}/day > ${t.healthRunsPerDayMax}/day`
        );
    if (k.waitP90S !== null && k.waitP90S > t.mutexWaitP90SMax)
        out.push(
            `mutex wait p90 ${Math.round(k.waitP90S)}s > ${t.mutexWaitP90SMax}s`
        );
    return out;
}

// ── rendering ───────────────────────────────────────────────────────────────

function secs(s: number | null): string {
    if (s === null) return "—";
    return s >= 120 ? `${(s / 60).toFixed(1)}m` : `${Math.round(s)}s`;
}

/** The four lines, one per KPI, for one window. */
export function formatKpiLines(k: WorkflowKpis, label: string): string[] {
    const days = (k.window.to - k.window.from) / 86400;
    const buckets = (Object.entries(k.byBucket) as [string, number][])
        .filter(([, n]) => n > 0)
        .map(([b, n]) => `${b} ${n}`)
        .join(", ");
    return [
        `${label} failed lands   ${k.failed}/${k.lands} (${k.failedPct.toFixed(1)}%)${buckets ? ` — ${buckets}` : ""}`,
        `${label} base RED       ${k.redHours.toFixed(1)} h (${days > 0 ? (k.redHours / days).toFixed(1) : "0"} h/day)`,
        `${label} health runs    ${k.healthRuns} tips gated, ${k.healthRed} red (${k.healthRunsPerDay.toFixed(1)}/day)`,
        `${label} mutex wait     p50 ${secs(k.waitP50S)} · p90 ${secs(k.waitP90S)} over ${k.waits} acquisitions`,
    ];
}

// ── health/detach.log ───────────────────────────────────────────────────────

/** A `detach.log` line worth keeping: a step's duration, a fire reason, or a
 *  verdict. Progress lines ("still running") and gate chatter are dropped. */
export type DetachEvent =
    | { kind: "step"; step: string; exit: string; secs: number }
    | { kind: "fire"; trigger: string; reason: string }
    | { kind: "verdict"; verdict: "GREEN" | "RED"; sha: string };

/** `6m12s`, `1h02m`, `45s` → seconds. */
export function parseDuration(s: string): number | null {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
    if (!m || s === "") return null;
    return (
        Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
    );
}

export function parseDetachLine(line: string): DetachEvent | null {
    const step =
        /^health-main: \[\d+\/\d+\] (.+?) — exit (\S+) after (\S+)$/.exec(line);
    if (step) {
        const secs = parseDuration(step[3]);
        return secs === null
            ? null
            : { kind: "step", step: step[1], exit: step[2], secs };
    }
    const fire = /^health-cadence: firing on (\S+) — (.+)$/.exec(line);
    if (fire) return { kind: "fire", trigger: fire[1], reason: fire[2] };
    const verdict = /^health-main: (GREEN|RED) @ ([0-9a-f]+)/.exec(line);
    if (verdict)
        return {
            kind: "verdict",
            verdict: verdict[1] as "GREEN" | "RED",
            sha: verdict[2],
        };
    return null;
}
