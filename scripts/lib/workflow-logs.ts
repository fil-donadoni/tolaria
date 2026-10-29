/**
 * The workflow's log lines `telemetry:ingest` keeps (issue #4968) — pure
 * over text: the stage a non-green `land` stopped in (`gate_attempts`), and
 * the `health/detach.log` lines (`health_detach`).
 *
 * The four KPIs this module once computed over them, their ceilings in
 * `tolaria.config.json` and `bun run workflow:kpi` went with issue #5652:
 * the cockpit (`bun run cockpit`) reads the workflow's trends off GitHub.
 */

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
 *  - `infra`  — the dependency install failed (exit 77) or the run was
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
    // The retired cadence's line (issue #5655): kept so the logs it wrote
    // still ingest; nothing writes it any more.
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
