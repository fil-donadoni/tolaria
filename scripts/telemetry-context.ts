/**
 * `bun run telemetry:context` — the per-turn cost curve and the per-bucket
 * context-growth breakdown, over an arbitrary day window (issue #3078).
 *
 * This is the measurement half of the context-hygiene contract in
 * `.claude/skills/next-issue/SKILL.md`: the contract is prose, and this is what
 * makes it checkable after the fact rather than by hand-written SQL. The
 * committed baseline it is compared against lives in
 * `docs/agents/quality-gates.md` § Context hygiene.
 *
 * Usage:
 *   bun run telemetry:context                          # last 7 days
 *   bun run telemetry:context --from 2026-08-28 --to 2026-09-05
 *   bun run telemetry:context --json                   # machine-readable
 *   bun run telemetry:context --min-turns 20 --db <path>
 *
 * The derivation (and what it deliberately cannot see) is documented on
 * `scripts/lib/telemetry-context.ts`, which holds every pure function here so
 * the analysis is testable under the `node` vitest project — `bun:sqlite` is
 * not importable there.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database as Sqlite } from "bun:sqlite";
import { primaryCheckout } from "./lib/primary-checkout.ts";
import {
    attributeGrowth,
    formatReport,
    summariseDeciles,
    type Span,
    type Turn,
} from "./lib/telemetry-context.ts";

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
 * The store lives in the primary checkout. A worktree has its own
 * `.claude/` but never the (gitignored) database, so resolving from
 * `CLAUDE_PROJECT_DIR` alone makes this command silently useless in exactly
 * the sessions it is meant to measure.
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
const minTurns = Number(arg("min-turns") ?? 10);
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
 * A session is taken WHOLE when any of its turns falls in the window. Deciles
 * are positions within a session, so truncating one at the window edge would
 * report its middle as its start — the one distortion that would invert the
 * curve this command exists to read.
 */
const SESSIONS_IN_WINDOW = `
    SELECT DISTINCT session FROM llm
    WHERE surface = 'main' AND day BETWEEN ? AND ?`;

const turns = db
    .query(
        `SELECT session, ts, cost, out_tok AS outTok,
                (in_tok + cache_read + cache_write) AS ctx
         FROM llm
         WHERE surface = 'main' AND session IN (${SESSIONS_IN_WINDOW})`
    )
    .all(from, to) as Turn[];

const spans = db
    .query(
        `SELECT session, ts, tool, cmd_bucket AS cmdBucket
         FROM spans
         WHERE session IN (${SESSIONS_IN_WINDOW})`
    )
    .all(from, to) as Span[];

db.close();

if (turns.length === 0) {
    console.error(`No main-thread turns between ${from} and ${to}.`);
    process.exit(1);
}

const deciles = summariseDeciles(turns, minTurns);
const perResponse = summariseDeciles(turns, minTurns, true);
const growth = attributeGrowth(turns, spans);
const sessions = new Set(turns.map((t) => t.session)).size;

if (asJson) {
    console.log(
        JSON.stringify(
            { from, to, sessions, minTurns, deciles, perResponse, growth },
            null,
            2
        )
    );
} else {
    console.log(formatReport(from, to, sessions, deciles, growth, perResponse));
}
