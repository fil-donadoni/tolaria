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
import { createRequire } from "node:module";
import type { Database } from "bun:sqlite";
import { gatherLoopStatus, fetchPriorityGracefully } from "./loop-status";
import type { GracefulPriority } from "./loop-status";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const DB_PATH = join(PROJECT_DIR, ".claude/telemetry/telemetry.db");
const HTML_PATH = join(PROJECT_DIR, "scripts/telemetry-dashboard.html");

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

/** Per-table whitelist: which columns may be grouped on or filtered by. */
const DIMENSIONS: Record<string, string[]> = {
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

/** Per-table whitelist of metrics, each mapping to a SQL aggregate. */
const METRICS: Record<string, Record<string, string>> = {
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
// a `gh project item-list --limit 2000` (+ a `project view` cross-check)
// permanently in flight, which is exactly the API-rate-limit burn the
// issue's cache requirement exists to prevent.
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
}

const defaultDeps: TelemetryDeps = { getLoopStatus: getLoopStatusCached };

/**
 * The whole route table, extracted from the `Bun.serve` listener (#2623) so
 * every route is callable with an in-memory `Request` — no socket, no
 * port, and (routes that take `deps`) no `gh`/`git` call either. Byte-
 * identical to the inline closure this replaced; `startServer` below is the
 * only thing that binds it to a real port.
 */
export async function handleRequest(
    req: Request,
    deps: TelemetryDeps = defaultDeps
): Promise<Response> {
    const url = new URL(req.url);
    try {
        // Reads no DB — must work even when telemetry.db is absent or
        // stale (#2519), so it is dispatched before any DB-backed route.
        if (url.pathname === "/api/loop-status") {
            return Response.json(await deps.getLoopStatus());
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
        if (url.pathname === "/api/q" && req.method === "POST") {
            // `req.json()` is `unknown` by design — every field it carries is
            // re-validated against the DIMENSIONS/METRICS allow-lists inside
            // runQuery, so the cast asserts shape, not trust.
            return Response.json(runQuery((await req.json()) as QueryBody));
        }
        if (url.pathname === "/" || url.pathname === "/index.html") {
            return new Response(Bun.file(HTML_PATH), {
                headers: { "content-type": "text/html; charset=utf-8" },
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
export function startServer(port: number = resolvePort()) {
    const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch: (req) => handleRequest(req),
    });
    console.log(`telemetry dashboard → http://127.0.0.1:${server.port}`);
    return server;
}

if (import.meta.main) {
    startServer();
}
