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
 *
 * The derivation (and what it deliberately cannot see) is documented on
 * `scripts/lib/telemetry-latency.ts`, which holds every pure function here so
 * the analysis is testable under the `node` vitest project — `bun:sqlite` is
 * not importable there.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database as Sqlite } from "bun:sqlite";
import { primaryCheckout } from "./lib/primary-checkout.ts";
import {
    allSessionLatencies,
    formatReport,
    isIssueClosing,
    isNextIssue,
    summarise,
    type LatencySpan,
    type LatencyTurn,
    type SessionMeta,
} from "./lib/telemetry-latency.ts";

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

db.close();

if (turns.length === 0) {
    console.error(`No main-thread turns between ${from} and ${to}.`);
    process.exit(1);
}

const meta: SessionMeta[] = metaRows.map((r) => ({
    session: r.session,
    cmd: r.cmd,
    prs: r.prs ? (JSON.parse(r.prs) as number[]) : [],
}));

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
        "/next-issue sessions (the ADR 0110 pipeline)",
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
            },
            null,
            2
        )
    );
} else {
    console.log(formatReport(from, to, cohorts, maxHours));
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
