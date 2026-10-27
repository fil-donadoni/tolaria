/**
 * `bun run telemetry:latency` — how long an issue actually takes, and where the
 * time goes (issue #3079).
 *
 * ADR 0110 targets "a median issue closes in 10-15 minutes" and nothing has
 * ever checked it, because nothing reported per-issue latency at all. This
 * splits each session's wall clock into tool execution, model generation and
 * human idle, and reports the distribution — median and p90, not means only.
 * The committed baseline it is compared against lives in
 * `docs/agents/quality-gates.md` § Latency per issue.
 *
 * Usage:
 *   bun run telemetry:latency                          # last 7 days
 *   bun run telemetry:latency --from 2026-08-28 --to 2026-09-05
 *   bun run telemetry:latency --json                   # machine-readable
 *   bun run telemetry:latency --sessions 10            # slowest sessions too
 *   bun run telemetry:latency --max-hours 12 --db <path>
 *   bun run telemetry:latency --headroom [N]           # tests near their
 *                                                      # testTimeout, last N
 *                                                      # health runs (20)
 *
 * The derivation (and what it deliberately cannot see) is documented on
 * `scripts/lib/telemetry-latency.ts`, which holds every pure function here so
 * the analysis is testable under the `node` vitest project — `bun:sqlite` is
 * not importable there.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database as Sqlite } from "bun:sqlite";
import { primaryCheckout } from "./lib/primary-checkout.ts";
import {
    allSessionLatencies,
    formatAdr0136Rows,
    formatThroughputRows,
    healthMutexByDay,
    hostBySessionFromClaims,
    landAttemptsPerPr,
    landMutexByDay,
    machineThroughput,
    type GateLockRow,
    formatReport,
    isIssueClosing,
    isNextIssue,
    laneHistogram,
    laneFallbackRate,
    landPrOfCommand,
    blockingFindingRate,
    isGitCommitCommand,
    hourlyThroughput,
    throughputByConcurrency,
    summarise,
    type LatencySpan,
    type LatencyTurn,
    type SessionMeta,
    type MergedPr,
    type ReviewSpan,
    type CommitEvent,
    type SessionMergeFact,
    type GateRunLane,
} from "./lib/telemetry-latency.ts";
import {
    formatHeadroomView,
    headroomView,
    type HeadroomRun,
    type TestDuration,
} from "./lib/test-headroom.ts";

function arg(name: string): string | null {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

function isoDay(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
}

/**
 * The store lives in the primary checkout. A worktree has its own `.claude/`
 * but never the (gitignored) database, so resolving from `CLAUDE_PROJECT_DIR`
 * alone makes this command silently useless in exactly the sessions it is
 * meant to measure.
 */
function resolveDbPath(): string {
    const explicit = arg("db");
    if (explicit) return explicit;
    const local = join(
        process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
        ".claude/telemetry/telemetry.db"
    );
    if (existsSync(local)) return local;
    return join(primaryCheckout(), ".claude/telemetry/telemetry.db");
}

const to = arg("to") ?? isoDay(new Date());
const from = arg("from") ?? isoDay(new Date(Date.now() - 6 * 24 * 3600 * 1000));
const maxHours = Number(arg("max-hours") ?? 12);
const showSessions = Number(arg("sessions") ?? 0);
const asJson = process.argv.includes("--json");

const dbPath = resolveDbPath();
if (!existsSync(dbPath)) {
    console.error(
        `No telemetry store at ${dbPath}. Run: bun run telemetry:ingest`
    );
    process.exit(1);
}

const db = new Sqlite(dbPath, { readonly: true });

/**
 * `--headroom [N]` (issue #5484): the tests above 50% of their `testTimeout`
 * in the last N health runs, worst ratio first, with the machine that
 * measured it — the risk named before it turns into a RED.
 */
function headroomReport(n: number): void {
    let runs: Array<{ sha12: string; machine: string; ts: number }>;
    try {
        runs = db
            .query(
                "SELECT sha12, machine, ts FROM test_headroom_runs ORDER BY ts DESC LIMIT ?"
            )
            .all(n) as typeof runs;
    } catch {
        console.error(
            "No test_headroom table yet. Run: bun run telemetry:ingest"
        );
        process.exit(1);
    }
    const rowsOf = db.query(
        `SELECT test, project, duration_ms AS durationMs, timeout_ms AS timeoutMs,
                'recorded' AS state
         FROM test_headroom WHERE sha12 = ?`
    );
    const full: HeadroomRun[] = runs.map((r) => ({
        ...r,
        records: rowsOf.all(r.sha12) as TestDuration[],
    }));
    const view = headroomView(full);
    if (asJson)
        console.log(JSON.stringify({ runs: full.length, view }, null, 2));
    else console.log(formatHeadroomView(view, full.length));
}

if (process.argv.includes("--headroom")) {
    const n = Number(arg("headroom"));
    headroomReport(Number.isInteger(n) && n > 0 ? n : 20);
    process.exit(0);
}

/**
 * A session is taken WHOLE when any of its turns falls in the window. Wall
 * clock is first-to-last message, so truncating a session at the window edge
 * would report a fragment of it as the whole issue — the one distortion that
 * would make the headline number meaningless.
 */
const SESSIONS_IN_WINDOW = `
    SELECT DISTINCT session FROM llm
    WHERE surface = 'main' AND day BETWEEN ? AND ?`;

const turns = db
    .query(
        `SELECT session, ts, out_tok AS outTok,
                (in_tok + cache_read + cache_write) AS ctx
         FROM llm
         WHERE surface = 'main' AND session IN (${SESSIONS_IN_WINDOW})`
    )
    .all(from, to) as LatencyTurn[];

const spans = db
    .query(
        `SELECT session, ts, dur_s AS durS, tool, cmd
         FROM spans
         WHERE session IN (${SESSIONS_IN_WINDOW})`
    )
    .all(from, to) as LatencySpan[];

const metaRows = db
    .query(
        `SELECT session, cmd, prs FROM sessions
         WHERE session IN (${SESSIONS_IN_WINDOW})`
    )
    .all(from, to) as Array<{
    session: string;
    cmd: string | null;
    prs: string | null;
}>;

// ─── The four ADR 0136 KPI rows (issue #3777) ──────────────────────────────

const reviewSpanRows = db
    .query(
        `SELECT session, ts AS startS, (ts + dur_s) AS endS, model_req AS model
         FROM spans
         WHERE session IN (${SESSIONS_IN_WINDOW}) AND role = 'review'`
    )
    .all(from, to) as ReviewSpan[];

// `cmd LIKE '%…%'` is a cheap pre-filter only — SQLite has no regex here, and
// a bare substring match would count a `grep -rn "git commit" ...` as a
// commit (`isGitCommitCommand` does the real,
// shape-aware check once the candidate rows are back in JS).
const commitEvents = (
    db
        .query(
            `SELECT session, ts, cmd
             FROM spans
             WHERE session IN (${SESSIONS_IN_WINDOW})
               AND tool = 'Bash' AND cmd LIKE '%commit%'`
        )
        .all(from, to) as Array<{ session: string; ts: number; cmd: string }>
).filter((r) => isGitCommitCommand(r.cmd)) as CommitEvent[];

// Not window-filtered by SESSIONS_IN_WINDOW: a PR's merge is a fact about the
// base branch, not about any one session.
const prMetaRows = db
    .query(
        "SELECT pr, merged_at AS mergedAt FROM pr_meta WHERE merged_at IS NOT NULL"
    )
    .all() as Array<{ pr: number; mergedAt: string }>;

// `lane_forced_by` is newer than the store (issue #4376) and this connection
// is READ-ONLY, so it cannot run the widening `openDb` does at ingest: a
// database that has not been ingested since is missing the column, and
// naming it unconditionally turns the whole report into a SQLite error. The
// column reads as NULL until the next `telemetry:ingest`, which is exactly
// what a pre-#4376 gate-run row means anyway — no fallback path recorded.
const hasLaneForcedBy = (
    db.query("PRAGMA table_info(gate_runs)").all() as Array<{ name: string }>
).some((c) => c.name === "lane_forced_by");
const gateRunRows = db
    .query(
        `SELECT cmd, base, lane, ${
            hasLaneForcedBy ? "lane_forced_by" : "NULL"
        } AS laneForcedBy, green, started FROM gate_runs`
    )
    .all() as Array<{
    cmd: string;
    base: string | null;
    lane: string | null;
    laneForcedBy: string | null;
    green: number;
    started: number | null;
}>;

// ─── Issue #5460: the four throughput-target rows ──────────────────────────

const gateLockRows = db
    .query(
        `SELECT ts, tier, event, cmd, waited_ms AS waitedMs, duration_ms AS durationMs
         FROM gate_lock WHERE ts BETWEEN ? AND ?`
    )
    .all(
        Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000),
        Math.floor(new Date(`${to}T23:59:59`).getTime() / 1000)
    ) as GateLockRow[];

const landAttemptRows = db
    .query(
        `SELECT cmd FROM gate_attempts
         WHERE started BETWEEN ? AND ? AND cmd LIKE 'land %'`
    )
    .all(
        Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000),
        Math.floor(new Date(`${to}T23:59:59`).getTime() / 1000)
    ) as Array<{ cmd: string }>;

db.close();

const claimsPath = join(dirname(dbPath), "claims.jsonl");
const hostBySession = hostBySessionFromClaims(
    existsSync(claimsPath) ? readFileSync(claimsPath, "utf8") : ""
);

if (turns.length === 0) {
    console.error(`No main-thread turns between ${from} and ${to}.`);
    process.exit(1);
}

const meta: SessionMeta[] = metaRows.map((r) => ({
    session: r.session,
    cmd: r.cmd,
    prs: r.prs ? (JSON.parse(r.prs) as number[]) : [],
}));

// Row 1 — PRs landed per hour, by active sessions that hour.
const merges: MergedPr[] = prMetaRows
    .map((r) => ({
        number: r.pr,
        mergedAtS: Math.floor(Date.parse(r.mergedAt) / 1000),
    }))
    .filter((m) => {
        if (Number.isNaN(m.mergedAtS)) return false;
        const day = isoDay(new Date(m.mergedAtS * 1000));
        return day >= from && day <= to;
    });
const concurrency = throughputByConcurrency(hourlyThroughput(turns, merges));
const throughput = {
    machines: machineThroughput(turns, merges, meta, hostBySession),
    landMutex: landMutexByDay(gateLockRows),
    healthMutex: healthMutexByDay(gateLockRows),
    landAttempts: landAttemptsPerPr(landAttemptRows),
};

// Row 2 — blocking-finding rate per reviewer model. A session's merge time
// caps how late a commit can still count as "fixed after review" — the
// earliest of its own PRs' merges, since ADR 0110's one-shot worktrees mean
// nothing legitimate is committed to that session after its own PR lands.
const mergedAtByPr = new Map(
    prMetaRows.map((r) => [r.pr, Math.floor(Date.parse(r.mergedAt) / 1000)])
);
const sessionMerges: SessionMergeFact[] = [];
for (const m of meta) {
    const times = m.prs
        .map((pr) => mergedAtByPr.get(pr))
        .filter((t): t is number => t !== undefined && !Number.isNaN(t));
    if (times.length > 0)
        sessionMerges.push({
            session: m.session,
            mergedAtS: Math.min(...times),
        });
}
const reviewers = blockingFindingRate(
    reviewSpanRows,
    commitEvents,
    sessionMerges
);

// Row 3 — gate-run lane histogram, windowed by the run's own start time (a
// gate run has no session in the general case — a hand-run `check:lane`
// links to none — so it cannot be windowed through SESSIONS_IN_WINDOW).
const fromS = Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000);
const toS = Math.floor(new Date(`${to}T23:59:59`).getTime() / 1000);
const inWindow = gateRunRows.filter(
    (g) => g.started !== null && g.started >= fromS && g.started <= toS
);
const gateRunLanes: GateRunLane[] = inWindow.map((g) => ({
    lane: g.lane,
    green: g.green === 1,
}));
const lanes = laneHistogram(gateRunLanes);

// Row 4 — lane fallback rate (issue #4376), over the LANDINGS in the same
// window: the `full` runs that were `full` because a path matched no lane
// rule, as opposed to the mixed src/**-plus-engine diffs `full` is for.
const fallback = laneFallbackRate(
    inWindow
        .filter((g) => landPrOfCommand(g.cmd) !== null)
        .map((g) => ({
            cmd: g.cmd,
            lane: g.lane,
            // `""` is the ingest's "parsed, no forcing path" sentinel; NULL is
            // "never parsed". Both mean no fallback here.
            forcedBy: g.laneForcedBy || null,
        }))
);

const maxSeconds = maxHours * 3600;
const rows = allSessionLatencies(turns, spans, meta).filter(
    (r) => r.wallS <= maxSeconds
);

const cohorts = [
    summarise(
        "issue-closing sessions (landed ≥1 PR)",
        rows.filter(isIssueClosing)
    ),
    summarise(
        "/next-ticket sessions (the ADR 0110 pipeline)",
        rows.filter(isNextIssue)
    ),
    summarise("all sessions in window", rows),
];

if (asJson) {
    console.log(
        JSON.stringify(
            {
                from,
                to,
                maxHours,
                cohorts,
                sessions: rows.slice(0, showSessions),
                adr0136: { concurrency, reviewers, lanes, fallback },
                throughput,
            },
            null,
            2
        )
    );
} else {
    console.log(formatReport(from, to, cohorts, maxHours));
    console.log("");
    console.log(formatAdr0136Rows(concurrency, reviewers, lanes, fallback));
    console.log(formatThroughputRows(throughput));
    if (showSessions > 0) {
        console.log("");
        console.log(`  slowest ${showSessions} sessions`);
        for (const r of rows.slice(0, showSessions)) {
            const m = (s: number) => `${(s / 60).toFixed(0)}m`;
            console.log(
                `  ${m(r.wallS).padStart(6)}  tool ${m(r.toolS).padStart(5)}` +
                    `  model ${m(r.modelS).padStart(5)}  idle ${m(r.idleS).padStart(6)}` +
                    `  ${(r.cmd ?? "(no command)").slice(0, 44)}`
            );
        }
    }
}
