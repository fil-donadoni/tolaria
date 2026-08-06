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
import { Database } from "bun:sqlite";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const DB_PATH = join(PROJECT_DIR, ".claude/telemetry/telemetry.db");
const HTML_PATH = join(PROJECT_DIR, "scripts/telemetry-dashboard.html");

if (!existsSync(DB_PATH)) {
    console.error(
        `No telemetry store at ${DB_PATH}. Run: bun run telemetry:ingest`
    );
    process.exit(1);
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

const db = new Database(DB_PATH, { readonly: true });

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
        rows: db.query(sql).all(...params),
        sql,
        metric,
        metrics: Object.keys(mets),
    };
}

/** Distinct values per dimension, so the UI can populate its filter pickers. */
function meta() {
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
            const rows = db
                .query<
                    { v: string },
                    []
                >(`SELECT DISTINCT ifnull(${d}, '(none)') AS v FROM ${table} ORDER BY v LIMIT 200`)
                .all();
            values[table][d] = rows.map((r) => r.v);
        }
    }
    out.values = values;

    const range = db
        .query<
            { min_day: string; max_day: string },
            []
        >("SELECT min(day) AS min_day, max(day) AS max_day FROM llm")
        .get();
    out.range = range;
    out.lastIngest = db
        .query<{ v: string }, []>("SELECT v FROM meta WHERE k = 'last_ingest'")
        .get()?.v;
    out.counts = db
        .query<Record<string, number>, []>(
            `SELECT (SELECT count(*) FROM spans) AS spans,
                    (SELECT count(*) FROM llm) AS llm,
                    (SELECT count(*) FROM agent_runs) AS agent_runs`
        )
        .get();
    return out;
}

const portArg = process.argv.indexOf("--port");
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 5174;

const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
        const url = new URL(req.url);
        try {
            if (url.pathname === "/api/meta") {
                return Response.json(meta());
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
            return Response.json({ error: String(err) }, { status: 400 });
        }
    },
});

console.log(`telemetry dashboard → http://127.0.0.1:${server.port}`);
