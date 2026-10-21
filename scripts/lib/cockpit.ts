// The cockpit (issue #5652, ADR 0156 Amendment I § The dashboard is
// simplified, not removed): one page of trends, no "now".
//
// `scripts/cockpit.ts` does the I/O: `telemetry:ingest`, this machine's
// `telemetry:budget` / `telemetry:latency` reading, the other machines' last
// `weekly-report` readings, the weekly report's GitHub facts over a window
// ending now (`gatherFacts`), GitHub's runner list — and writes the
// reading the page renders (`cockpit-reading.ts`). The decisions below are
// PURE — where the reading lives, the runner states, which machine reading
// wins, when the page is rebuilt — so the tests run them on recorded answers.

import { homedir } from "node:os";
import { join } from "node:path";
import type { RunnerRow } from "./afk-dispatch";
import type { RunnerState, RunnerView } from "./cockpit-reading";
import type { MachineReading } from "./workflow-trends";

/** What an operator types to open it. */
export const COCKPIT_COMMAND = "bun run cockpit";

/** The machine-local directory the cockpit keeps its reading and its
 *  artifact cache in — never a checkout, so every worktree shares one.
 *  `TOLARIA_COCKPIT_DIR` points it elsewhere (the tests). */
export function cockpitDir(
    env: NodeJS.ProcessEnv = process.env,
    home: string = homedir()
): string {
    return (
        env.TOLARIA_COCKPIT_DIR || join(home, ".cache", "tolaria", "cockpit")
    );
}

/** The reading the server hands the page. */
export function cockpitReadingPath(env: NodeJS.ProcessEnv = process.env) {
    return join(cockpitDir(env), "cockpit.json");
}

/** Downloaded run artifacts: a completed run's never change. */
export function cockpitArtifactCache(env: NodeJS.ProcessEnv = process.env) {
    return join(cockpitDir(env), "artifacts");
}

const ROLE_LABELS = new Set(["pass", "lane", "seed"]);

/** GitHub's runner list as the page shows it: by host, then name. */
export function runnerViews(rows: readonly RunnerRow[]): RunnerView[] {
    return rows
        .map((r) => {
            const host = r.labels.find((l) => l.startsWith("host:"));
            return {
                name: r.name,
                host: host ? host.slice("host:".length) : null,
                roles: r.labels.filter((l) => ROLE_LABELS.has(l)).sort(),
                state: (r.status !== "online"
                    ? "offline"
                    : r.busy
                      ? "busy"
                      : "idle") as RunnerState,
            };
        })
        .sort(
            (a, b) =>
                (a.host ?? "").localeCompare(b.host ?? "") ||
                a.name.localeCompare(b.name)
        );
}

/**
 * The machines the cockpit reports: THIS machine's fresh reading, then each
 * other host's newest one from the `weekly-report` runs — an older reading
 * of this machine is dropped, the fresh one stands for it.
 */
export function machinesToReport(
    local: MachineReading,
    stored: readonly MachineReading[]
): MachineReading[] {
    const others = new Map<string, MachineReading>();
    for (const m of stored)
        if (m.host !== local.host && !others.has(m.host)) others.set(m.host, m);
    return [
        local,
        ...[...others.values()].sort((a, b) => a.host.localeCompare(b.host)),
    ];
}

/**
 * Whether the dashboard build must be (re)made: none, or a source newer than
 * it. `bun run cockpit` runs in the primary checkout, which every merge
 * fast-forwards — a build made last week renders last week's page.
 */
export function buildIsStale(
    builtAtMs: number | null,
    newestSourceMs: number
): boolean {
    return builtAtMs === null || newestSourceMs > builtAtMs;
}
