/**
 * `bun run workflow:kpi` — the four workflow KPIs over the last 7 and 14 days
 * (issue #4968): % failed lands by bucket, hours the base was RED, health
 * runs per day, p50/p90 heavy-mutex wait. Exits 1 when any crosses its
 * ceiling in `tolaria.config.json` § `workflow`.
 *
 * Runs `telemetry:ingest --quick` first so the numbers are never older than
 * the call (`--no-ingest` skips it). `--from=YYYY-MM-DD --to=YYYY-MM-DD`
 * (both local dates, `--to` inclusive) prints one custom window instead.
 *
 * The pure half — classification, windows, thresholds, rendering — is
 * `lib/workflow-kpi.ts`; this file owns the database.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Database as Sqlite } from "bun:sqlite";
import { openDb } from "./lib/telemetry-db.ts";
import {
    computeWorkflowKpis,
    formatKpiLines,
    kpiBreaches,
    readKpiThresholds,
    type HealthVerdict,
    type KpiWindow,
    type LandAttempt,
    type LandBucket,
    type MutexWait,
    type WorkflowKpis,
} from "./lib/workflow-kpi.ts";

const DAY_S = 86400;

export function telemetryDbPath(root: string): string {
    return join(root, ".claude/telemetry/telemetry.db");
}

export function loadKpiInputs(db: Sqlite): {
    lands: LandAttempt[];
    health: HealthVerdict[];
    waits: MutexWait[];
} {
    const lands = db
        .query<{ started: number; green: number; bucket: string | null }, []>(
            "SELECT started, green, bucket FROM gate_attempts WHERE cmd LIKE 'land %'"
        )
        .all()
        .map((r) => ({
            started: r.started,
            green: r.green === 1,
            bucket: r.bucket as LandBucket | null,
        }));
    const health = db
        .query<{ ts: number; red: number }, []>(
            "SELECT ts, red FROM health_runs"
        )
        .all()
        .map((r) => ({ ts: r.ts, red: r.red === 1 }));
    const waits = db
        .query<{ ts: number; waited_ms: number }, []>(
            "SELECT ts, waited_ms FROM gate_lock WHERE waited_ms IS NOT NULL AND tier = 'heavy'"
        )
        .all()
        .map((r) => ({ ts: r.ts, waitedMs: r.waited_ms }));
    return { lands, health, waits };
}

/** The last-7 and last-14-day windows ending at `nowS`. */
export function rollingWindows(nowS: number): Array<[string, KpiWindow]> {
    return [7, 14].map((d) => [
        `${String(d).padStart(2)}d`,
        { from: nowS - d * DAY_S, to: nowS },
    ]);
}

/**
 * The four lines per rolling window, read from `root`'s telemetry DB — what
 * `health-cadence` prints when it fires. Never throws: a missing or
 * unreadable DB is one line saying so.
 */
export function kpiReport(root: string, nowS = Date.now() / 1000): string[] {
    const path = telemetryDbPath(root);
    if (!existsSync(path)) return [`workflow:kpi: no telemetry DB at ${path}`];
    try {
        const db = openDb(path);
        try {
            const input = loadKpiInputs(db);
            return rollingWindows(nowS).flatMap(([label, w]) =>
                formatKpiLines(computeWorkflowKpis(input, w), label)
            );
        } finally {
            db.close();
        }
    } catch (e) {
        return [
            `workflow:kpi: could not read ${path} — ${(e as Error).message}`,
        ];
    }
}

function flag(name: string): string | null {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : null;
}

/** A local `YYYY-MM-DD` → epoch seconds at local midnight. */
function localDay(s: string): number {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new Error(`not a YYYY-MM-DD date: ${s}`);
    return (
        new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 1000
    );
}

function main(): number {
    const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    if (!process.argv.includes("--no-ingest")) {
        const r = spawnSync(
            "bun",
            [join(import.meta.dir, "telemetry-ingest.ts"), "--quick"],
            { stdio: ["ignore", "ignore", "inherit"], env: process.env }
        );
        if (r.status !== 0)
            console.error(
                "workflow:kpi: telemetry:ingest --quick failed — reporting the DB as it is"
            );
    }
    const path = telemetryDbPath(root);
    if (!existsSync(path)) {
        console.error(`workflow:kpi: no telemetry DB at ${path}`);
        return 2;
    }
    const thresholds = readKpiThresholds();
    const from = flag("from");
    const to = flag("to");
    const windows: Array<[string, KpiWindow]> =
        from !== null || to !== null
            ? [
                  [
                      `${from}→${to}`,
                      {
                          from: localDay(from ?? "1970-01-01"),
                          to: to
                              ? localDay(to) + DAY_S
                              : Math.floor(Date.now() / 1000),
                      },
                  ],
              ]
            : rollingWindows(Math.floor(Date.now() / 1000));

    const db = openDb(path);
    const input = loadKpiInputs(db);
    db.close();

    const breaches: string[] = [];
    for (const [label, w] of windows) {
        const k: WorkflowKpis = computeWorkflowKpis(input, w);
        for (const line of formatKpiLines(k, label)) console.log(line);
        breaches.push(
            ...kpiBreaches(k, thresholds).map((b) => `${label} ${b}`)
        );
    }
    if (breaches.length === 0) {
        console.log("workflow:kpi: every KPI within its ceiling");
        return 0;
    }
    for (const b of breaches) console.error(`workflow:kpi: OVER — ${b}`);
    return 1;
}

if (import.meta.main) process.exit(main());
