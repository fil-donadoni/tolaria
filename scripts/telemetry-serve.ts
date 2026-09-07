/**
 * Local telemetry dashboard server.
 *
 * Serves the static dashboard plus a single aggregate endpoint. Every query is
 * a GROUP BY against the SQLite mirror, so the browser never holds the fact
 * rows — filtering and splitting stay instant regardless of how large the
 * underlying JSONL grows.
 *
 * Column and metric names are whitelisted here rather than interpolated from
 * the request: the request body reaches SQL text, so an allow-list is the only
 * thing standing between a filter parameter and arbitrary SQL.
 *
 * Usage: bun run telemetry:dash [--port 5174]
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Database } from "bun:sqlite";
import { gatherLoopStatus, fetchPriorityGracefully } from "./loop-status";
import type { GracefulPriority } from "./loop-status";
import { homedir } from "node:os";
import { primaryCheckout } from "./lib/primary-checkout";
import { injectActionToken } from "./lib/action-token";
import {
    DASHBOARD_BUILD_COMMAND,
    DASHBOARD_OUT_DIR,
    readDashboardBuild,
} from "./lib/dashboard-build";
import type { DashboardBuild } from "./lib/dashboard-build";
import {
    LiveIndex,
    readTail,
    SESSION_ID_RE,
    ACTIVITY_WINDOW_HOURS,
    LIVE_SESSION_MINUTES,
    ACTIVE_SESSION_MINUTES,
} from "./lib/live-activity";
import type { SessionSummary } from "./lib/live-activity";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const DB_PATH = join(PROJECT_DIR, ".claude/telemetry/telemetry.db");
/** Where `vite.dashboard.config.ts` writes the built dashboard (ADR 0117).
 *  Nothing is served from outside it. */
const DASHBOARD_BUILD_DIR = join(PROJECT_DIR, DASHBOARD_OUT_DIR);
/** Where the harness keeps this project's session transcripts — the same
 *  slug rule `telemetry-ingest.ts` uses (`/` → `-`), and the ONLY root the
 *  live routes ever read under (issue #3135). */
const PROJECTS_ROOT = join(homedir(), ".claude/projects");
/** Slugged from the PRIMARY checkout, not the cwd: a dashboard launched from
 *  an issue worktree still shows the project's sessions — the worktree's own
 *  `<slug>-issue-N` directory is one of the dirs the slug's prefix owns. */
const PROJECT_SLUG = primaryCheckout(PROJECT_DIR).replace(/\//g, "-");

/**
 * The dashboard's build, read ONCE per process (ADR 0117).
 *
 * `undefined` means "not looked at yet"; `null` means "looked, and there is no
 * build". Both are distinct from a `DashboardBuild`, and the difference is why
 * this is not a plain `??=`: a missing build must not be re-`stat`ed on every
 * request, and it must keep answering 503 until the operator rebuilds and
 * restarts — the process reads the manifest at boot by design, so the set of
 * served names cannot drift under a running server.
 */
let dashboardBuildCache: DashboardBuild | null | undefined;
function loadDashboardBuild(): DashboardBuild | null {
    if (dashboardBuildCache === undefined) {
        dashboardBuildCache = readDashboardBuild(DASHBOARD_BUILD_DIR);
    }
    return dashboardBuildCache;
}

/** The one answer for every dashboard route when there is no build: which
 *  command makes one. Never a blank page, never a stack trace. */
function noDashboardBuildResponse(): Response {
    return new Response(
        `the telemetry dashboard is not built — run: ${DASHBOARD_BUILD_COMMAND}`,
        {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
        }
    );
}

/** Everything under this prefix is an allow-list lookup and nothing else. */
const ASSET_PREFIX = "/assets/";

/**
 * `bun:sqlite` is a Bun-only builtin with no Node equivalent — a top-level
 * `import { Database } from "bun:sqlite"` makes importing THIS MODULE fail
 * outright under the `node` vitest project (#2623), regardless of whether a
 * store ever gets opened. `createRequire` defers resolution to the one call
 * site that actually needs it, and that call site only runs when
 * `existsSync(DB_PATH)` is true — never the case for a fresh worktree/test
 * environment with no `.claude/telemetry/telemetry.db`, so `handleRequest`'s
 * route test never touches the Bun-only builtin at all. Kept synchronous
 * (a `require`, not a dynamic `import()`) so `requireDb()` and every route
 * that calls it stay synchronous — no cascading async refactor.
 */
const requireModule = createRequire(import.meta.url);
function openDatabase(path: string): Database {
    const { Database: DatabaseCtor } = requireModule(
        "bun:sqlite"
    ) as typeof import("bun:sqlite");
    return new DatabaseCtor(path, { readonly: true });
}

/**
 * `telemetry.db` is built by `telemetry:ingest` and goes stale/absent between
 * runs (#2519: last written 2026-08-08 at the time this route was added).
 * The server used to refuse to boot without it — `existsSync` → `exit(1)` —
 * which took the WHOLE dashboard down, including `/api/loop-status`, which
 * reads no DB at all and is exactly the view an operator needs when
 * everything else here is stale. So `db` is lazy and nullable: the process
 * always starts, and only the DB-BACKED routes fail, with a clear message
 * naming the fix, when there is nothing to query.
 */
let db: Database | null = existsSync(DB_PATH) ? openDatabase(DB_PATH) : null;

/** Thrown by `requireDb()` — caught once, in the route dispatcher, and
 *  turned into a 503 rather than the generic 400 every other query error
 *  gets: "there is no store yet" is an operational fact, not a bad request. */
class NoTelemetryStoreError extends Error {}

function requireDb(): Database {
    if (db) return db;
    // A store created by a concurrent `telemetry:ingest` after this process
    // started is picked up on the NEXT request rather than requiring a
    // restart — cheap to check, and `existsSync` is the same test the
    // startup path already used.
    if (existsSync(DB_PATH)) {
        db = openDatabase(DB_PATH);
        return db;
    }
    throw new NoTelemetryStoreError(
        `No telemetry store at ${DB_PATH}. Run: bun run telemetry:ingest`
    );
}

/** Per-table whitelist: which columns may be grouped on or filtered by.
 *  Exported because it is a VOCABULARY, not just a guard: the dashboard
 *  glossary's completeness test (#2629) iterates it and reds when a dimension
 *  added here has no human label. */
export const DIMENSIONS: Record<string, string[]> = {
    spans: [
        "day",
        "hour",
        "tool",
        "kind",
        "role",
        "agent_type",
        "model_req",
        "skill",
        "cmd_bucket",
        "session",
    ],
    llm: [
        "day",
        "hour",
        "model",
        "effort",
        "surface",
        "agent_type",
        "role",
        "session",
    ],
    agent_runs: ["day", "hour", "model", "agent_type", "role", "session"],
};

/** Per-table whitelist of metrics, each mapping to a SQL aggregate.
 *  Exported for the same reason as `DIMENSIONS` above (#2629). */
export const METRICS: Record<string, Record<string, string>> = {
    spans: {
        calls: "count(*)",
        total_seconds: "sum(dur_s)",
        avg_seconds: "avg(dur_s)",
        max_seconds: "max(dur_s)",
    },
    llm: {
        messages: "count(*)",
        cost_usd: "sum(cost)",
        output_tokens: "sum(out_tok)",
        input_tokens: "sum(in_tok)",
        cache_read_tokens: "sum(cache_read)",
        cache_write_tokens: "sum(cache_write)",
        avg_output_tokens: "avg(out_tok)",
    },
    agent_runs: {
        runs: "count(*)",
        total_seconds: "sum(dur_s)",
        avg_seconds: "avg(dur_s)",
        max_seconds: "max(dur_s)",
        cost_usd: "sum(cost)",
        avg_cost_usd: "avg(cost)",
        output_tokens: "sum(out_tok)",
        messages: "sum(msgs)",
    },
};

interface QueryBody {
    table?: string;
    metric?: string;
    groupBy?: string[];
    filters?: Record<string, string[]>;
    from?: string;
    to?: string;
    limit?: number;
}

function runQuery(body: QueryBody) {
    const table = body.table ?? "llm";
    const dims = DIMENSIONS[table];
    const mets = METRICS[table];
    if (!dims || !mets) throw new Error(`unknown table: ${table}`);

    const metric = body.metric ?? Object.keys(mets)[0]!;
    const agg = mets[metric];
    if (!agg) throw new Error(`unknown metric: ${metric}`);

    const groupBy = (body.groupBy ?? []).filter((g) => dims.includes(g));

    const where: string[] = [];
    const params: (string | number)[] = [];
    if (body.from) {
        where.push("day >= ?");
        params.push(body.from);
    }
    if (body.to) {
        where.push("day <= ?");
        params.push(body.to);
    }
    for (const [col, vals] of Object.entries(body.filters ?? {})) {
        if (!dims.includes(col) || !vals?.length) continue;
        where.push(
            `ifnull(${col}, '(none)') IN (${vals.map(() => "?").join(",")})`
        );
        params.push(...vals);
    }

    // Always return every metric alongside the selected one — the table view
    // shows them all, and a second round trip per column is pure waste.
    const metricCols = Object.entries(mets)
        .map(([name, expr]) => `${expr} AS "${name}"`)
        .join(", ");
    const groupCols = groupBy
        .map((g) => `ifnull(${g}, '(none)') AS "${g}"`)
        .join(", ");

    const sql =
        `SELECT ${groupCols ? groupCols + ", " : ""}${metricCols} FROM ${table}` +
        (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
        (groupBy.length
            ? ` GROUP BY ${groupBy.map((_, i) => i + 1).join(",")}`
            : "") +
        ` ORDER BY "${metric}" DESC LIMIT ${Math.min(body.limit ?? 500, 5000)}`;

    return {
        rows: requireDb()
            .query(sql)
            .all(...params),
        sql,
        metric,
        metrics: Object.keys(mets),
    };
}

/** Distinct values per dimension, so the UI can populate its filter pickers. */
function meta() {
    const database = requireDb();
    const out: Record<string, unknown> = {
        dimensions: DIMENSIONS,
        metrics: METRICS,
        values: {},
    };
    const values: Record<string, Record<string, string[]>> = {};
    for (const [table, dims] of Object.entries(DIMENSIONS)) {
        values[table] = {};
        for (const d of dims) {
            // session ids are high-cardinality and useless in a picker.
            if (d === "session") continue;
            const rows = database
                .query<
                    { v: string },
                    []
                >(`SELECT DISTINCT ifnull(${d}, '(none)') AS v FROM ${table} ORDER BY v LIMIT 200`)
                .all();
            values[table][d] = rows.map((r) => r.v);
        }
    }
    out.values = values;

    const range = database
        .query<
            { min_day: string; max_day: string },
            []
        >("SELECT min(day) AS min_day, max(day) AS max_day FROM llm")
        .get();
    out.range = range;
    out.lastIngest = database
        .query<{ v: string }, []>("SELECT v FROM meta WHERE k = 'last_ingest'")
        .get()?.v;
    out.counts = database
        .query<Record<string, number>, []>(
            `SELECT (SELECT count(*) FROM spans) AS spans,
                    (SELECT count(*) FROM llm) AS llm,
                    (SELECT count(*) FROM agent_runs) AS agent_runs`
        )
        .get();
    return out;
}

/** Validate a YYYY-MM-DD query param (these reach SQL as bound params only). */
function dayParam(url: URL, name: string, fallback: string): string {
    const v = url.searchParams.get(name) ?? fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`bad ${name}`);
    return v;
}

/**
 * Narrative view: one row per session, newest first. Role minutes/cost come
 * from agent_runs; the orchestrator column is the session's main-surface llm
 * spend; wall clock is the llm first→last message span.
 */
function sessionsView(from: string, to: string) {
    return requireDb()
        .query(
            `WITH span AS (
                SELECT session, min(ts) AS t0, max(ts) AS t1,
                       round(sum(CASE WHEN surface='main' THEN cost ELSE 0 END),2) AS orch_cost,
                       round(sum(cost),2) AS cost,
                       sum(out_tok) AS out_tok, sum(cache_read) AS cache_read
                FROM llm WHERE day >= ?1 AND day <= ?2 GROUP BY session
            ), roles AS (
                SELECT session,
                       sum(CASE WHEN role='implement' THEN dur_s ELSE 0 END) AS impl_s,
                       sum(CASE WHEN role='review' THEN dur_s ELSE 0 END) AS rev_s,
                       sum(CASE WHEN role='fixup' THEN dur_s ELSE 0 END) AS fix_s,
                       sum(CASE WHEN role NOT IN ('implement','review','fixup') THEN dur_s ELSE 0 END) AS other_s,
                       count(*) AS runs,
                       count(DISTINCT issue) AS issues
                FROM agent_runs WHERE day >= ?1 AND day <= ?2 GROUP BY session
            )
            SELECT s.session, se.title, se.cmd, se.prs,
                   s.t0, s.t1, round((s.t1 - s.t0) / 60.0, 0) AS wall_min,
                   round(ifnull(r.impl_s,0)/60,0) AS impl_min,
                   round(ifnull(r.rev_s,0)/60,0) AS rev_min,
                   round(ifnull(r.fix_s,0)/60,0) AS fix_min,
                   round(ifnull(r.other_s,0)/60,0) AS other_min,
                   ifnull(r.runs,0) AS runs, ifnull(r.issues,0) AS issues,
                   s.orch_cost, s.cost, s.out_tok, s.cache_read
            FROM span s
            LEFT JOIN sessions se ON se.session = s.session
            LEFT JOIN roles r ON r.session = s.session
            ORDER BY s.t0 DESC LIMIT 200`
        )
        .all(from, to);
}

/**
 * Narrative view: one row per issue. Per-role minutes / tokens / cost, run
 * count, latency (first→last event across its runs), tier, family, state.
 */
function issuesView(from: string, to: string) {
    const rows = requireDb()
        .query(
            `SELECT r.issue, m.title, m.family, m.state, m.closed_at,
                   min(r.started) AS first_ts,
                   count(*) AS runs,
                   round((max(r.started + r.dur_s) - min(r.started)) / 60.0, 0) AS latency_min,
                   -- the tier the IMPLEMENT ran on (modal across implement runs)
                   (SELECT model FROM agent_runs x WHERE x.issue = r.issue AND x.role='implement'
                    GROUP BY model ORDER BY count(*) DESC LIMIT 1) AS impl_model,
                   sum(CASE WHEN r.role='implement' THEN r.dur_s ELSE 0 END)/60 AS impl_min,
                   sum(CASE WHEN r.role='implement' THEN r.cost ELSE 0 END) AS impl_cost,
                   sum(CASE WHEN r.role='implement' THEN r.out_tok ELSE 0 END) AS impl_out_tok,
                   sum(CASE WHEN r.role='review' THEN r.dur_s ELSE 0 END)/60 AS rev_min,
                   sum(CASE WHEN r.role='review' THEN r.cost ELSE 0 END) AS rev_cost,
                   sum(CASE WHEN r.role='review' THEN r.out_tok ELSE 0 END) AS rev_out_tok,
                   sum(CASE WHEN r.role='fixup' THEN r.dur_s ELSE 0 END)/60 AS fix_min,
                   sum(CASE WHEN r.role='fixup' THEN r.cost ELSE 0 END) AS fix_cost,
                   sum(CASE WHEN r.role='fixup' THEN 1 ELSE 0 END) AS fixups,
                   sum(CASE WHEN r.role NOT IN ('implement','review','fixup') THEN r.dur_s ELSE 0 END)/60 AS other_min,
                   sum(CASE WHEN r.role NOT IN ('implement','review','fixup') THEN r.cost ELSE 0 END) AS other_cost,
                   round(sum(r.cost),2) AS cost,
                   sum(r.out_tok) AS out_tok, sum(r.cache_read) AS cache_read
            FROM agent_runs r
            LEFT JOIN issue_meta m ON m.issue = r.issue
            WHERE r.issue IS NOT NULL AND ifnull(m.state,'') != 'pr'
              AND r.day >= ?1 AND r.day <= ?2
            GROUP BY r.issue
            ORDER BY cost DESC LIMIT 300`
        )
        .all(from, to) as Record<string, unknown>[];

    // Fixup-rate per implement tier — the number that governs de-escalation.
    const tiers: Record<string, { issues: number; withFixup: number }> = {};
    for (const r of rows) {
        const tier = String(r.impl_model ?? "(none)");
        tiers[tier] ??= { issues: 0, withFixup: 0 };
        tiers[tier].issues++;
        if (Number(r.fixups) > 0) tiers[tier].withFixup++;
    }
    return { rows, tiers };
}

/** Per-family × role rollup — "what do reviews on mechanics issues cost". */
function familiesView(from: string, to: string) {
    return requireDb()
        .query(
            `SELECT ifnull(m.family, '(none)') AS family, r.role,
                   count(*) AS runs, count(DISTINCT r.issue) AS issues,
                   round(sum(r.dur_s)/60, 0) AS minutes,
                   sum(r.out_tok) AS out_tok, sum(r.cache_read) AS cache_read,
                   round(sum(r.cost), 2) AS cost
            FROM agent_runs r
            LEFT JOIN issue_meta m ON m.issue = r.issue
            WHERE r.issue IS NOT NULL AND ifnull(m.state,'') != 'pr'
              AND r.day >= ?1 AND r.day <= ?2
            GROUP BY 1, 2 ORDER BY family, cost DESC`
        )
        .all(from, to);
}

/** Drill-down: the individual agent runs of one issue or one session. */
function runsView(url: URL) {
    const issue = url.searchParams.get("issue");
    const session = url.searchParams.get("session");
    if (!issue && !session) throw new Error("issue or session required");
    const [col, val] = issue
        ? ["issue", Number(issue)]
        : ["session", String(session)];
    if (issue && !Number.isFinite(val as number)) throw new Error("bad issue");
    return requireDb()
        .query(
            `SELECT r.agent_id, r.session, r.started, round(r.dur_s/60,1) AS min,
                    r.msgs, r.model, r.agent_type, r.role, r.issue,
                    r.out_tok, r.cache_read,
                    round(r.cache_read * 1.0 / max(r.msgs,1) / 1000, 0) AS avg_ctx_k,
                    round(r.cost, 2) AS cost, m.description
             FROM agent_runs r
             LEFT JOIN agent_meta m ON m.agent_id = r.agent_id
             WHERE r.${col} = ? ORDER BY r.started`
        )
        .all(val);
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/loop-status (#2519) — `gatherLoopStatus` shells out to `gh`/`git`, so
// this caches the PROMISE, not just the resolved value: several open tabs
// (or one tab re-polling every 10s) hitting this route inside the same
// window must share a single in-flight gather rather than each firing their
// own round of `gh` calls. A failed gather is NOT cached — the next request
// retries rather than being stuck replaying a stale error for the rest of
// the TTL.
//
// TWO caches, not one (PR #2545 review, finding 2). Measured on this branch:
//   first curl  = 200, 41.18s
//   "cached" curl = 200, 27.60s  (NOT actually a hit — the 10s TTL had
//                                 already expired mid-gather, so this was a
//                                 second full gather, just a faster one)
// With a single 10s TTL, no poll is EVER served from cache, because the
// gather itself takes far longer than the TTL — an open dashboard tab keeps
// a board read permanently in flight, which is exactly the API-rate-limit
// burn the issue's cache requirement exists to prevent. (The measurements
// above are from when that read was `gh project item-list --limit 2000` plus
// a `project view` cross-check; it is now one paginated GraphQL query, ~100x
// cheaper and no longer the thing dominating this route's latency.)
//
// The board-priority read is what dominates that latency, and it is also
// the LEAST volatile part of the payload — the `Priority` field on the
// board does not change every 10 seconds — so it gets its own cache with a
// much longer TTL, decoupled from claims/queue/receipts, which stay fast and
// keep the short TTL below. In steady state this means: at most one slow
// board read every `PRIORITY_TTL_MS`, and every OTHER poll — including the
// very next one after a cold start — resolves in low single-digit seconds
// because it only pays for git/gh calls that were never the bottleneck.
// ─────────────────────────────────────────────────────────────────────────────

// Back to 5 minutes (2026-09-07). This was widened to 30 because the board
// read cost ~768 GraphQL points against a 5000-point/HOUR pool, so an open
// dashboard tab asking every 5 minutes spent 1.8x the entire quota on its
// own — the burn that left the account at `graphql 0/5000` with REST
// untouched. The read is now one paginated query for the `Priority` field
// alone instead of `gh project item-list`'s every-field page:
//
//     old: gh project view + item-list  →  766 points   (351 priorities)
//     new: the query in lib/board-priority.ts  →  8 points  (351 priorities,
//                                                  byte-identical map)
//
// At 8 points a tab polling every 5 minutes costs ~96 points an hour, 2% of
// the pool. The freshness the 30-minute value gave up was never the point,
// so it comes back.
const PRIORITY_TTL_MS = 5 * 60_000;
let priorityCache: {
    promise: Promise<GracefulPriority>;
    expiresAt: number;
} | null = null;

function getPriorityCached(): Promise<GracefulPriority> {
    const now = Date.now();
    if (priorityCache && priorityCache.expiresAt > now) {
        return priorityCache.promise;
    }
    const promise = (async () => fetchPriorityGracefully(false))();
    priorityCache = { promise, expiresAt: now + PRIORITY_TTL_MS };
    promise.catch(() => {
        if (priorityCache?.promise === promise) priorityCache = null;
    });
    return promise;
}

const LOOP_STATUS_TTL_MS = 30_000;
let loopStatusCache: { promise: Promise<unknown>; expiresAt: number } | null =
    null;

function getLoopStatusCached(): Promise<unknown> {
    const now = Date.now();
    if (loopStatusCache && loopStatusCache.expiresAt > now) {
        return loopStatusCache.promise;
    }
    const promise = (async () => {
        const priorityOverride = await getPriorityCached();
        return gatherLoopStatus({ priorityOverride });
    })();
    loopStatusCache = { promise, expiresAt: now + LOOP_STATUS_TTL_MS };
    promise.catch(() => {
        // Only clear if nothing newer has already replaced this entry.
        if (loopStatusCache?.promise === promise) loopStatusCache = null;
    });
    return promise;
}

// ─────────────────────────────────────────────────────────────────────────────
// The action endpoint (#2628)
//
// Three reversible driver operations, and a refusal for everything else.
// Arming and disarming are DELIBERATELY absent: arming is a durable human act
// recorded in plain text (`.claude/telemetry/afk.conf`) so it can be read,
// audited and revoked, and putting it behind a button would undo the reason it
// is a file. Everything beyond the three actions stays a copied command.
//
// Three independent guards, ALL required, none a substitute for another:
//
//   1. The loopback-only binding in `startServer` (`hostname: "127.0.0.1"`),
//      unchanged by this ticket.
//   2. `ACTION_TOKEN_HEADER`, carrying a token minted once per server boot and
//      injected into the served page. Without it any other process on this
//      machine could drive the loop by guessing a URL — the loopback binding
//      says nothing about WHICH local process is calling.
//   3. An `Origin` check, so a page open in another tab cannot post here. The
//      token alone would not stop that: a cross-origin `fetch` is sent, it is
//      only the RESPONSE the other origin cannot read — and these three
//      operations have their effect on the way in.
//
// Each is checked with the other two satisfied in the tests, which is what
// "independent" means operationally.
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_PATH = "/api/action";
const ACTION_TOKEN_HEADER = "x-loop-action-token";

/**
 * Minted once, at module load — i.e. once per server boot, since the only
 * production path into this module is the `import.meta.main` bootstrap below.
 *
 * NOT exported, never written to disk, never passed to `console.*`: the whole
 * value of the guard is that the token exists in exactly two places, this
 * process's memory and the `<head>` of the page this process served. A copy in
 * a log file or a dotfile would outlive the boot it belongs to and turn a
 * per-boot secret into a durable one. `telemetry-serve.test.ts` guards both
 * halves (the module has exactly one `console.` call and no file write; no
 * exported binding is a UUID).
 */
const BOOT_ACTION_TOKEN = randomUUID();

/**
 * The origins allowed to post to the action endpoint: the loopback literals at
 * the port the server actually bound.
 *
 * Built from LITERALS rather than derived from `req.url`. Deriving it would be
 * the tempting one-liner (`new URL(req.url).origin`) and it fails open to DNS
 * rebinding: a page at `http://evil.example`, whose name resolves to
 * 127.0.0.1, reaches this server with `Host: evil.example` AND
 * `Origin: http://evil.example`, so a Host-derived allow-list matches its own
 * attacker-chosen value. A literal list cannot.
 *
 * Port-scoped, not "any loopback host": a page served by the Vite dev server
 * on `http://localhost:5173` is a different origin and has no business here.
 */
export function loopbackOrigins(port: number): ReadonlySet<string> {
    return new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
        `http://[::1]:${port}`,
    ]);
}

/**
 * The three operations, as an injectable seam — the same shape as
 * `getLoopStatus` / `readAsset` above and for the same reason: the route's job
 * is dispatch and refusal, and a test must be able to prove which of the two
 * happened without writing a stop-file or calling `gh`.
 */
export interface DriverActions {
    /** Writes the stop-file. The driver exits after its current pass. */
    stopDriver(): Promise<void>;
    /** Clears the stop-file and starts a driver. */
    resumeDriver(): Promise<void>;
    /** Removes the in-progress claim on EXACTLY this issue. */
    releaseClaim(issue: number): Promise<void>;
}

const execFileAsync = promisify(execFile);

/** A command and its arguments, as one array — the exact thing handed to
 *  `execFile`, and the exact thing a test can assert without spawning it. */
export type OperationArgv = readonly [command: string, ...args: string[]];

/**
 * `execFile`, never `exec`: the arguments are an argv array handed straight to
 * the kernel, so no value below is ever parsed by a shell. That is what makes
 * `claim.release`'s issue number safe even before the integer check —
 * belt and braces, since the check is the thing that actually holds.
 *
 * `cwd` is the PRIMARY checkout: `loop-handoff.sh` resolves every path
 * relative to the caller's cwd on purpose (its own header comment), and the
 * files it touches are gitignored, so a linked worktree has none of them.
 */
async function runOperation([cmd, ...args]: OperationArgv): Promise<void> {
    await execFileAsync(cmd, args, { cwd: PROJECT_DIR });
}

/**
 * The argv of every operation, as DATA rather than as three call sites
 * (#2628 review round 1, finding 2). `driver.stop` and `driver.resume`
 * originally shipped with `["scripts/loop-handoff.sh", "stop"]` — a bare word
 * that script's argv parser refuses (`scripts/loop-handoff.sh:93-147`: only
 * the `--`-prefixed modes match, everything else falls to `*)`, prints the
 * usage and exits 2), so both actions answered 500 and did nothing. Every
 * test injected a stub `DriverActions`, so nothing in the suite ever looked
 * at the argv at all.
 *
 * Naming the argv here is what makes it assertable:
 * `telemetry-serve.test.ts` pins these three arrays AND cross-checks the
 * `loop-handoff.sh` modes against the option list parsed out of the script
 * itself — so the test reds whether the drift is on this side or that one.
 *
 * `driver.stop` / `driver.resume` go through `scripts/loop-handoff.sh` rather
 * than touching `.claude/telemetry/loop-stop` here: that script already owns
 * the stop-file path, the blocked-reason checks and the detached
 * `launch_driver` spawn, and a second writer of the same path is exactly how
 * the two drift. `claim.release` runs the same command
 * `.claude/hooks/claim-sweep.sh` runs when it reaps an orphan, so a claim
 * released from the dashboard and a claim released by the sweep end in the
 * same state.
 */
export const DRIVER_COMMANDS = {
    stopDriver: (): OperationArgv => [
        "sh",
        "scripts/loop-handoff.sh",
        "--stop",
    ],
    resumeDriver: (): OperationArgv => [
        "sh",
        "scripts/loop-handoff.sh",
        "--resume",
    ],
    releaseClaim: (issue: number): OperationArgv => [
        "gh",
        "issue",
        "edit",
        String(issue),
        "--remove-label",
        "in-progress",
        "--remove-assignee",
        "@me",
    ],
} as const;

/**
 * The real operations, built over an injectable spawn. Production passes
 * `runOperation`; the test passes a recorder, which is how the argv above is
 * proven through the SAME construction production uses rather than through a
 * copy of it restated in the test.
 */
export function makeDriverActions(
    run: (argv: OperationArgv) => Promise<void>
): DriverActions {
    return {
        stopDriver: () => run(DRIVER_COMMANDS.stopDriver()),
        resumeDriver: () => run(DRIVER_COMMANDS.resumeDriver()),
        releaseClaim: (issue) => run(DRIVER_COMMANDS.releaseClaim(issue)),
    };
}

const defaultDriverActions: DriverActions = makeDriverActions(runOperation);

type ActionHandler = (
    body: Record<string, unknown>,
    actions: DriverActions
) => Promise<Response>;

/**
 * The allow-list, as an EXACT-MATCH lookup.
 *
 * The action string from the request is used as a `Map` key and for nothing
 * else. There is deliberately no `trim()`, no `toLowerCase()`, no unicode
 * normalisation and no aliasing: `"Driver.Stop"`, `" driver.stop"` and
 * `"driver.stop\n"` are unknown actions and are refused. A forgiving parser
 * here would be a second, undocumented spelling of a privileged operation —
 * the thing an allow-list exists to prevent — and it would silently widen
 * every future entry too.
 *
 * `Map`, not a plain object, so `__proto__` / `constructor` / `toString` are
 * ordinary missing keys rather than inherited truthy values (same reasoning as
 * the dashboard's asset map (`scripts/lib/dashboard-build.ts`)).
 */
const ACTION_ALLOW_LIST: ReadonlyMap<string, ActionHandler> = new Map<
    string,
    ActionHandler
>([
    [
        "driver.stop",
        async (_body, actions) => {
            await actions.stopDriver();
            return Response.json({ ok: true, action: "driver.stop" });
        },
    ],
    [
        "driver.resume",
        async (_body, actions) => {
            await actions.resumeDriver();
            return Response.json({ ok: true, action: "driver.resume" });
        },
    ],
    [
        "claim.release",
        async (body, actions) => {
            // "acts on exactly the issue named and no other": a positive
            // integer, or nothing happens. A numeric STRING is refused rather
            // than coerced — `"2628 2629"` and `"2628"` are both strings, and
            // a coercion that accepts the second is one `Number()` away from
            // being asked to explain the first.
            const issue = body.issue;
            if (
                typeof issue !== "number" ||
                !Number.isInteger(issue) ||
                issue <= 0
            ) {
                return refuseAction(400, "issue must be a positive integer");
            }
            await actions.releaseClaim(issue);
            return Response.json({ ok: true, action: "claim.release", issue });
        },
    ],
]);

/**
 * Every refusal from this endpoint. The body names the guard that refused —
 * useful to the operator, and it discloses nothing: it never echoes the boot
 * token, and never reports whether some OTHER guard would also have refused.
 */
function refuseAction(status: number, reason: string): Response {
    return Response.json({ ok: false, error: reason }, { status });
}

/**
 * Constant-time comparison, so the token cannot be recovered a byte at a time
 * by timing the refusal. Unequal lengths short-circuit (`timingSafeEqual`
 * throws on mismatched buffers) — that leaks the LENGTH of the boot token,
 * which is a fixed, public property of `randomUUID` anyway.
 */
function tokenMatches(presented: string, expected: string): boolean {
    // An EMPTY expected token is not a secret, and `timingSafeEqual` on two
    // empty buffers returns `true` (#2628 review round 1, finding 6) — so an
    // injected `""` would accept every request that happens to send an empty
    // header, disarming guard 2 completely. The `??` resolution below cannot
    // catch this: `"" ?? default` is `""`. Refuse here instead, which is the
    // fail-closed reading — with no token there is nothing to authenticate
    // against, so nothing authenticates.
    if (expected.length === 0) return false;
    const a = Buffer.from(presented, "utf8");
    const b = Buffer.from(expected, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

/**
 * The action route. Guards in order — Origin, then token, then the allow-list
 * — each returning its own refusal.
 *
 * Two decisions the CR of HTTP does not make for us, made deliberately here:
 *
 * - **A missing token and a wrong token are two separate refusals.** Both are
 *   401 (the caller is unauthenticated either way), with distinct reasons so
 *   the operator can tell "the page did not send it" from "the page is stale
 *   and holding a token from a previous boot" — the second is the one that
 *   means "reload". Neither reveals any part of the real token.
 * - **A missing `Origin` is refused, exactly like a disallowed one.** Fail
 *   closed. Every browser sets `Origin` on a POST, including a same-origin
 *   one, so the legitimate caller always has it; the requests that lack it are
 *   the non-browser ones — a `curl` from another local process — which is
 *   precisely the traffic guard 2 and guard 3 exist to refuse. Treating absent
 *   as allowed would make the guard opt-out by omission.
 */
async function handleActionRequest(
    req: Request,
    actionToken: string,
    allowedOrigins: ReadonlySet<string>,
    driverActions: DriverActions
): Promise<Response> {
    if (req.method !== "POST") {
        return refuseAction(405, "action endpoint accepts POST only");
    }

    // Guard 3 — Origin.
    const origin = req.headers.get("origin");
    if (origin === null) return refuseAction(403, "missing Origin");
    if (!allowedOrigins.has(origin)) {
        return refuseAction(403, "disallowed Origin");
    }

    // Guard 2 — the boot token.
    const presented = req.headers.get(ACTION_TOKEN_HEADER);
    if (presented === null) return refuseAction(401, "missing action token");
    if (!tokenMatches(presented, actionToken)) {
        return refuseAction(401, "invalid action token");
    }

    let parsed: unknown;
    try {
        parsed = await req.json();
    } catch {
        return refuseAction(400, "malformed JSON body");
    }
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        return refuseAction(400, "body must be a JSON object");
    }
    const body = parsed as Record<string, unknown>;

    // The allow-list. Exact match — see ACTION_ALLOW_LIST.
    const action = body.action;
    if (typeof action !== "string") {
        return refuseAction(400, "unknown action");
    }
    const handler = ACTION_ALLOW_LIST.get(action);
    if (!handler) return refuseAction(400, "unknown action");

    try {
        return await handler(body, driverActions);
    } catch (err) {
        // The operation itself failed (a `resume` refused because the loop is
        // not armed, a `gh` call that could not reach GitHub). Surface it: the
        // operator is looking at the page and can act on it. `String(err)`
        // carries the child process's stderr and never the token, which is
        // passed to no operation.
        return Response.json(
            { ok: false, error: String(err) },
            { status: 500 }
        );
    }
}

/**
 * Per-request dependencies `handleRequest` closes over — today just the
 * loop-status gather, which is the one route a route test must be able to
 * answer WITHOUT shelling out to `gh`/`git` (#2623). Defaults to the real,
 * TTL-cached gather; a test passes a stub instead. This is parameter
 * injection, the same seam shape `GatherLoopStatusOptions.claimsRunner` /
 * `queueRunner` already use in `loop-status.ts` — never `vi.mock`, which
 * would leave leaked module state for sibling files sharing this worker
 * (the `node` project runs with `isolate: false` on that exact promise).
 */
export interface TelemetryDeps {
    getLoopStatus: () => Promise<unknown>;
    /**
     * Reads one file off disk. Injected for the same reason
     * `getLoopStatus` is: the `node` vitest project has no `Bun.file`, so an
     * asset route built on it could not be tested at all — and the
     * allow-list is precisely the part that must be. `node:fs/promises`
     * would be portable enough on its own, but the injection also lets the
     * test assert WHICH path the route asked for, which is how "the request
     * string never reaches the filesystem" is proven rather than asserted.
     */
    readAsset: (absolutePath: string) => Promise<string>;
    /**
     * Reads one BUILT asset as bytes. Separate from `readAsset` because that
     * one decodes UTF-8, which is right for the document and silently wrong
     * for everything a bundle can contain that is not text — a font, an icon,
     * an image. Vite would hash and manifest such a file correctly and the
     * server would hand out mojibake under a correct `Content-Type`, which is
     * the worst shape of bug: no error anywhere. S1 adds the shadcn primitives
     * and the fonts that go with them, so this is a live path, not a
     * hypothetical one.
     */
    readAssetBytes: (absolutePath: string) => Promise<Uint8Array>;
    /**
     * The token required on `/api/action` and injected into the served page
     * (#2628). Defaults to this process's boot token; a test injects a known
     * one, which is what lets the accept-path be exercised at all without
     * exporting the real one.
     */
    actionToken: string;
    /** The origins allowed to post to `/api/action` (#2628). */
    allowedOrigins: ReadonlySet<string>;
    /** The three reversible operations `/api/action` dispatches (#2628). */
    driverActions: DriverActions;
    /**
     * The dashboard's build manifest, or `null` when it has not been built
     * (ADR 0117). Injected for the same reason `readAsset` is: the serving
     * allow-list is the part that must be tested, and a test cannot run a
     * Vite build to obtain one.
     */
    dashboardBuild: DashboardBuild | null;
    /**
     * The transcript index behind `/api/activity`, `/api/live` and
     * `/api/tail` (issue #3135). Injected so a test can point it at a temp
     * directory it wrote itself — the default reads the operator's real
     * `~/.claude/projects/<slug>*`, which no test may touch.
     */
    liveIndex: LiveIndex;
}

/** One index per process, built on first use — `refresh` walks the disk,
 *  and nothing should walk it at import time. */
let liveIndexSingleton: LiveIndex | null = null;
function defaultLiveIndex(): LiveIndex {
    liveIndexSingleton ??= new LiveIndex({
        projectsRoot: PROJECTS_ROOT,
        projectSlug: PROJECT_SLUG,
    });
    return liveIndexSingleton;
}

const defaultDeps: TelemetryDeps = {
    getLoopStatus: getLoopStatusCached,
    readAsset: (absolutePath) => readFile(absolutePath, "utf8"),
    readAssetBytes: (absolutePath) => readFile(absolutePath),
    get dashboardBuild() {
        return loadDashboardBuild();
    },
    actionToken: BOOT_ACTION_TOKEN,
    allowedOrigins: loopbackOrigins(resolvePort()),
    driverActions: defaultDriverActions,
    get liveIndex() {
        return defaultLiveIndex();
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Live routes (issue #3135) — transcripts, never the store. Each refresh is
// throttled: a poll every few seconds from every open tab must not re-walk
// ~50 multi-megabyte files each time, and the index's own byte cursors make a
// refresh that finds nothing new cost one `stat` per file.
// ─────────────────────────────────────────────────────────────────────────────

const LIVE_REFRESH_MIN_MS = 2_000;
const lastRefreshByIndex = new WeakMap<LiveIndex, number>();

function refreshThrottled(index: LiveIndex, nowMs: number): void {
    const last = lastRefreshByIndex.get(index) ?? 0;
    if (nowMs - last < LIVE_REFRESH_MIN_MS) return;
    lastRefreshByIndex.set(index, nowMs);
    index.refresh(nowMs);
}

/** A session summary as the page receives it — the mentions map reduced to
 *  the issues it names most, and liveness stated as words, not left to the
 *  client to re-derive from timestamps. */
export function sessionView(s: SessionSummary, nowMs: number) {
    const ageMin = (nowMs - s.lastWriteMs) / 60_000;
    const topIssues = Object.entries(s.mentions)
        .map(([issue, n]) => ({ issue: Number(issue), mentions: n }))
        .sort((a, b) => b.mentions - a.mentions)
        .slice(0, 3);
    return {
        session: s.session,
        title: s.title,
        lastPrompt: s.lastPrompt,
        cwd: s.cwd,
        gitBranch: s.gitBranch,
        lastWriteMs: s.lastWriteMs,
        lastMessageMs: s.lastMessageMs,
        outTok: s.outTok,
        inTok: s.inTok,
        cacheRead: s.cacheRead,
        cost: s.cost,
        messages: s.messages,
        subagents: s.subagents,
        topIssues,
        liveness:
            ageMin <= ACTIVE_SESSION_MINUTES
                ? "active"
                : ageMin <= LIVE_SESSION_MINUTES
                  ? "live"
                  : "idle",
    };
}

/** `/api/activity` — one bucket per hour of the window. */
function activityView(index: LiveIndex, nowMs: number) {
    refreshThrottled(index, nowMs);
    return {
        windowHours: ACTIVITY_WINDOW_HOURS,
        asOf: index.refreshedAt,
        buckets: index.activity(nowMs),
    };
}

/**
 * `/api/live?issues=3096,3100` — the sessions live right now, and for each
 * issue asked about, the sessions most likely working it.
 */
function liveView(index: LiveIndex, url: URL, nowMs: number) {
    refreshThrottled(index, nowMs);
    const issues = (url.searchParams.get("issues") ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    const byIssue: Record<number, ReturnType<typeof sessionView>[]> = {};
    for (const issue of issues) {
        byIssue[issue] = index
            .sessionsForIssue(issue, nowMs)
            .map((s) => sessionView(s, nowMs));
    }
    return {
        asOf: index.refreshedAt,
        liveMinutes: LIVE_SESSION_MINUTES,
        activeMinutes: ACTIVE_SESSION_MINUTES,
        sessions: index.liveSessions(nowMs).map((s) => sessionView(s, nowMs)),
        byIssue,
    };
}

/**
 * `/api/tail?session=<uuid>&offset=<bytes>` — the conversation as a person
 * reads it. The session id is validated against `SESSION_ID_RE` BEFORE it
 * touches a path and resolved only inside this slug's own project
 * directories (`LiveIndex.transcriptPath`); anything else is a 400 or a 404,
 * and no other spelling of a path exists on this route.
 */
function tailView(index: LiveIndex, url: URL, nowMs: number): Response {
    const session = url.searchParams.get("session") ?? "";
    if (!SESSION_ID_RE.test(session)) {
        return Response.json({ error: "bad session id" }, { status: 400 });
    }
    const path = index.transcriptPath(session);
    if (!path) {
        return Response.json({ error: "no such session" }, { status: 404 });
    }
    const rawOffset = url.searchParams.get("offset");
    const offset =
        rawOffset === null || rawOffset === ""
            ? null
            : Number.isInteger(Number(rawOffset)) && Number(rawOffset) >= 0
              ? Number(rawOffset)
              : null;
    refreshThrottled(index, nowMs);
    const summary = index.session(session);
    return Response.json({
        ...readTail(path, session, offset),
        summary: summary ? sessionView(summary, nowMs) : null,
    });
}

/** The three security-relevant dependencies, resolved. */
export interface SecurityDeps {
    actionToken: string;
    allowedOrigins: ReadonlySet<string>;
    driverActions: DriverActions;
}

/**
 * The three security-relevant dependencies are resolved with `??`, NOT by a
 * spread (#2628): `{ ...defaults, ...{ actionToken: undefined } }` yields
 * `undefined`, and an explicitly-undefined key is exactly the shape a caller
 * building `deps` from optional fields produces. Through the spread that would
 * silently disarm the guard — `allowedOrigins.has(...)` throws and the outer
 * catch turns a refusal into a 400, `tokenMatches` compares against nothing.
 * Through `??` each falls back to the boot value. Fail closed on the caller's
 * mistake, not open.
 *
 * A FUNCTION rather than three lines inside `handleRequest` (#2628 review
 * round 1, finding 3) so the decision itself is directly assertable: the
 * reviewer swapped the `??`s for a spread and all 45 tests stayed green, which
 * is a guard that does not fire. `telemetry-serve.test.ts` now calls this with
 * all three keys explicitly `undefined`.
 */
export function resolveSecurityDeps(
    deps: Partial<TelemetryDeps>
): SecurityDeps {
    return {
        actionToken: deps.actionToken ?? defaultDeps.actionToken,
        allowedOrigins: deps.allowedOrigins ?? defaultDeps.allowedOrigins,
        driverActions: deps.driverActions ?? defaultDeps.driverActions,
    };
}

/**
 * The whole route table, extracted from the `Bun.serve` listener (#2623) so
 * every route is callable with an in-memory `Request` — no socket, no
 * port, and (routes that take `deps`) no `gh`/`git` call either. Byte-
 * identical to the inline closure this replaced; `startServer` below is the
 * only thing that binds it to a real port.
 */
export async function handleRequest(
    req: Request,
    deps: Partial<TelemetryDeps> = {}
): Promise<Response> {
    // `Partial`, so a test that only cares about one seam keeps passing one
    // key — adding `readAsset` in #2625 must not force every existing call
    // site to name every dependency.
    const {
        getLoopStatus,
        readAsset,
        readAssetBytes,
        liveIndex,
        dashboardBuild,
    } = {
        ...defaultDeps,
        ...deps,
    };
    const { actionToken, allowedOrigins, driverActions } =
        resolveSecurityDeps(deps);
    const url = new URL(req.url);
    try {
        // Reads no DB — must work even when telemetry.db is absent or
        // stale (#2519), so it is dispatched before any DB-backed route.
        if (url.pathname === "/api/loop-status") {
            return Response.json(await getLoopStatus());
        }
        // The live routes (issue #3135) read transcripts, not the store —
        // dispatched with `/api/loop-status`, before any DB-backed route,
        // for the same reason.
        if (url.pathname === "/api/activity") {
            return Response.json(activityView(liveIndex, Date.now()));
        }
        if (url.pathname === "/api/live") {
            return Response.json(liveView(liveIndex, url, Date.now()));
        }
        if (url.pathname === "/api/tail") {
            return tailView(liveIndex, url, Date.now());
        }
        if (url.pathname === "/api/meta") {
            return Response.json(meta());
        }
        if (url.pathname === "/api/sessions") {
            const from = dayParam(url, "from", "1970-01-01");
            const to = dayParam(url, "to", "9999-12-31");
            return Response.json({ rows: sessionsView(from, to) });
        }
        if (url.pathname === "/api/issues") {
            const from = dayParam(url, "from", "1970-01-01");
            const to = dayParam(url, "to", "9999-12-31");
            return Response.json(issuesView(from, to));
        }
        if (url.pathname === "/api/families") {
            const from = dayParam(url, "from", "1970-01-01");
            const to = dayParam(url, "to", "9999-12-31");
            return Response.json({ rows: familiesView(from, to) });
        }
        if (url.pathname === "/api/runs") {
            return Response.json({ rows: runsView(url) });
        }
        if (url.pathname === ACTION_PATH) {
            // Matched on PATH alone, so a GET here answers 405 from the
            // action route rather than falling through to the 404 fallback —
            // "this endpoint exists and you used it wrong" is a different
            // fact from "no such route", and only one of them is true.
            return await handleActionRequest(
                req,
                actionToken,
                allowedOrigins,
                driverActions
            );
        }
        if (url.pathname === "/api/q" && req.method === "POST") {
            // `req.json()` is `unknown` by design — every field it carries is
            // re-validated against the DIMENSIONS/METRICS allow-lists inside
            // runQuery, so the cast asserts shape, not trust.
            return Response.json(runQuery((await req.json()) as QueryBody));
        }
        if (url.pathname === "/" || url.pathname === "/index.html") {
            if (!dashboardBuild) return noDashboardBuildResponse();
            // The boot token rides into the page here and nowhere else
            // (#2628) — it is served, never stored. The document is the
            // BUILD's `index.html` (ADR 0117): it already carries the hashed
            // asset URLs, so the injection is the only thing left to do.
            const shell = await readAsset(dashboardBuild.htmlPath);
            return new Response(injectActionToken(shell, actionToken), {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (url.pathname.startsWith(ASSET_PREFIX)) {
            if (!dashboardBuild) return noDashboardBuildResponse();
            // The remainder of the path is used as a Map KEY and for nothing
            // else. There is no `join` with it, no normalisation, no
            // `startsWith` containment check — a name the build did not write
            // (including every spelling of a traversal) simply misses and
            // 404s. The manifest replaced the list of literals; it did not
            // replace that property. See `scripts/lib/dashboard-build.ts`.
            const asset = dashboardBuild.assets.get(
                url.pathname.slice(ASSET_PREFIX.length)
            );
            if (!asset) return new Response("not found", { status: 404 });
            // BYTES, never a decoded string — see `readAssetBytes`.
            return new Response(await readAssetBytes(asset.path), {
                headers: { "content-type": asset.type },
            });
        }
        return new Response("not found", { status: 404 });
    } catch (err) {
        if (err instanceof NoTelemetryStoreError) {
            return Response.json({ error: err.message }, { status: 503 });
        }
        return Response.json({ error: String(err) }, { status: 400 });
    }
}

/**
 * `TELEMETRY_SERVE_PORT` exists only so the bootstrap-guard test can pick a
 * port that is guaranteed not to collide with a real `bun run telemetry:dash`
 * an operator may already have open on the well-known default (#2623) —
 * production always launches with it unset, so `bun run telemetry:dash`'s
 * behaviour (port 5174 absent a `--port` flag) is unchanged.
 */
function resolvePort(): number {
    const portArg = process.argv.indexOf("--port");
    if (portArg > -1) return Number(process.argv[portArg + 1]);
    const envPort = process.env.TELEMETRY_SERVE_PORT;
    return envPort ? Number(envPort) : 5174;
}

/**
 * Binds `handleRequest` to a real loopback socket. The ONLY caller in
 * production is the `import.meta.main` guard below — so importing this
 * module (as the test file does) never opens a port (#2623). Bun has no
 * `require.main === module`; `import.meta.main` is the idiomatic
 * equivalent and reads `false` for a module reached via `import()`.
 */
export interface StartServerOptions {
    /**
     * The origins the SERVED PAGE will have, when that is not this server's
     * own bound port. Only `--dev` passes it: there the document comes from
     * the Vite dev server, so the origin allowed to POST `/api/action` is
     * Vite's — this process's ephemeral port never appears in a browser.
     * Still built from `loopbackOrigins`' literals, never from a request.
     */
    pageOrigins?: ReadonlySet<string>;
    /**
     * Whether to print the banner. `false` in `--dev`, where Vite prints the
     * URL the operator actually opens and this server's port is an
     * implementation detail nobody should type.
     */
    announce?: boolean;
}

export function startServer(
    port: number = resolvePort(),
    { pageOrigins, announce = true }: StartServerOptions = {}
) {
    // The Origin allow-list is built from the port the server ACTUALLY bound,
    // not from the one requested (#2628): `startServer(0)` lets the OS pick,
    // and an allow-list naming port 0 would refuse the page this very server
    // just served. Reassigned below, before `Bun.serve` can dispatch a first
    // request — read through a `let` rather than off `server` inside its own
    // initializer, which TypeScript cannot type (TS7022/TS7023).
    let origins: ReadonlySet<string> = pageOrigins ?? loopbackOrigins(port);
    const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch: (req) => handleRequest(req, { allowedOrigins: origins }),
    });
    // `server.port` is optional in Bun's types (a unix-socket server has
    // none); this one is always a TCP listener, so the fallback is the
    // requested port rather than a widening of the allow-list.
    origins = pageOrigins ?? loopbackOrigins(server.port ?? port);
    if (announce) {
        console.log(`telemetry dashboard → http://127.0.0.1:${server.port}`);
    }
    return server;
}

/**
 * `--dev` (ADR 0117): the page comes from Vite, every `/api/*` route still
 * comes from this server.
 *
 * The topology is deliberately that way round rather than "Bun proxies
 * `/assets/*` to Vite": HMR is a WebSocket upgrade plus a module graph, and
 * proxying it through a hand-written Bun handler is a second, worse
 * implementation of something Vite's own dev server already does. Vite binds
 * the well-known port — so `bun run telemetry:dash --dev` still means "open
 * http://127.0.0.1:5174" — and proxies `/api` here.
 *
 * The boot token reaches the dev document through the CHILD'S ENVIRONMENT and
 * nowhere else (`vite.dashboard.config.ts`'s `tolaria:dev-action-token`). It
 * is never written to disk, never logged, and no HTTP route ever hands it out.
 */
function startDevServer(): void {
    const pagePort = resolvePort();
    const api = startServer(0, {
        pageOrigins: loopbackOrigins(pagePort),
        announce: false,
    });
    const vite = Bun.spawn(
        [
            "bunx",
            "vite",
            "--config",
            "vite.dashboard.config.ts",
            "--port",
            String(pagePort),
            "--strictPort",
        ],
        {
            cwd: PROJECT_DIR,
            stdio: ["inherit", "inherit", "inherit"],
            env: {
                ...process.env,
                TELEMETRY_DEV_API_PORT: String(api.port ?? 0),
                TELEMETRY_DEV_ACTION_TOKEN: BOOT_ACTION_TOKEN,
            },
        }
    );
    // The API server exists only to answer the dev page: when Vite is gone,
    // so is the page, and a stray Bun listener holding the token in memory is
    // exactly what the per-boot token exists to avoid.
    void vite.exited.then((code) => {
        api.stop(true);
        process.exit(code ?? 0);
    });
}

if (import.meta.main) {
    if (process.argv.includes("--dev")) startDevServer();
    else startServer();
}
