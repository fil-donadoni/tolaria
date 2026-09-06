/**
 * `bun run telemetry:budget` — what an issue costs as a SHARE of the weekly
 * allowance, not in list-price dollars (issue #3080).
 *
 * ADR 0110's second target — "an issue costs under 0.5% of the weekly budget"
 * — had no denominator and had therefore never been checked: every figure the
 * telemetry layer produced was an API list-price equivalent, useful for
 * comparing two eras of this project and meaningless as a share of the plan the
 * work is actually drawn against. The incident that motivated the target (91%
 * of a weekly allowance in 48h, ADR 0109) is the same failure one layer down:
 * the guard reported `pct=n/a` because nothing had declared a budget.
 *
 * Usage:
 *   bun run telemetry:budget                                  # last 7 days
 *   bun run telemetry:budget --allowance 1.08G                # with a denominator
 *   bun run telemetry:budget --from 2026-08-28 --to 2026-09-05
 *   bun run telemetry:budget --issues 15                      # the costliest issues
 *   bun run telemetry:budget --json --db <path>
 *
 * The allowance may also come from `$TOLARIA_WEEKLY_ALLOWANCE`. **Without one
 * every share reads `n/a`** — this command never invents a percentage, which is
 * the whole point of the issue. The unit, the two currencies and how a row
 * becomes an issue's cost are documented on `scripts/lib/telemetry-budget.ts`,
 * which holds every pure function here so the analysis is testable under the
 * `node` vitest project (`bun:sqlite` is not importable there).
 *
 * Scope note: this reads the SQLite mirror, which covers THIS project only. The
 * account-wide reader is `bun run usage:window`, which walks every project's
 * transcripts and shares this command's unit — so an issue's share here is a
 * share of the whole allowance, while the window total is this project's part
 * of it.
 *
 * Exit code: 0 on a report, 1 when the store or the window is empty. Never
 * non-zero for a missing allowance — this is a reporter, not a gate, and issue
 * #3080 explicitly rules out enforcement.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Database as Sqlite } from "bun:sqlite";
import { primaryCheckout } from "./lib/primary-checkout.ts";
import { costOf, unitsOf } from "./lib/telemetry-db.ts";
import {
    WEEKLY_ALLOWANCE_ENV,
    attributeIssues,
    cohorts,
    formatReport,
    resolveAllowance,
    type SessionConsumption,
    type WindowTotals,
} from "./lib/telemetry-budget.ts";

/** ADR 0110's stated per-issue ceiling, as a percentage of the weekly allowance. */
const TARGET_PCT = 0.5;

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
 * but never the (gitignored) database — the same resolution
 * `telemetry-latency.ts` uses, and for the same reason: this command is meant
 * to be run from inside the very worktrees it measures.
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
const showIssues = Number(arg("issues") ?? 0);
const asJson = process.argv.includes("--json");

const allowanceFlag = arg("allowance");
const allowance = resolveAllowance({
    flag: allowanceFlag,
    env: process.env[WEEKLY_ALLOWANCE_ENV] ?? null,
});
// An unparsable value is not an absent one: it is a typo in the only number
// every percentage divides by, and staying silent about it would report
// "share unavailable" for a denominator the user believes they configured. The
// rejected value is named, because when a flag is refused the environment still
// holds a different one and "unusable allowance" alone would not say which.
if (!allowance) {
    const rejected =
        allowanceFlag !== null
            ? { value: allowanceFlag, from: "--allowance" }
            : process.env[WEEKLY_ALLOWANCE_ENV]
              ? {
                    value: process.env[WEEKLY_ALLOWANCE_ENV],
                    from: `$${WEEKLY_ALLOWANCE_ENV}`,
                }
              : null;
    if (rejected) {
        console.error(
            `telemetry:budget: ${rejected.from}=${JSON.stringify(rejected.value)} is not a usable allowance ` +
                `— expected a positive number of weighted tokens, optionally suffixed M or G. ` +
                `Every share below reads "n/a"; no other value is substituted.`
        );
    }
}

const dbPath = resolveDbPath();
if (!existsSync(dbPath)) {
    console.error(
        `No telemetry store at ${dbPath}. Run: bun run telemetry:ingest`
    );
    process.exit(1);
}

const db = new Sqlite(dbPath, { readonly: true });

// One row per (session, model): the smallest grouping that still lets `costOf`
// and `unitsOf` be applied per model, which they must be — both are per-model
// functions and averaging across models would be a third currency.
const rows = db
    .query(
        `SELECT l.session AS session, l.model AS model,
                SUM(l.in_tok) AS inTok, SUM(l.out_tok) AS outTok,
                SUM(l.cache_read) AS cacheRead, SUM(l.cache_write) AS cacheWrite
         FROM llm l
         WHERE l.day BETWEEN ? AND ?
         GROUP BY l.session, l.model`
    )
    .all(from, to) as Array<{
    session: string;
    model: string;
    inTok: number;
    outTok: number;
    cacheRead: number;
    cacheWrite: number;
}>;

const sessionCmd = new Map(
    (
        db.query(`SELECT session, cmd FROM sessions`).all() as Array<{
            session: string;
            cmd: string | null;
        }>
    ).map((r) => [r.session, r.cmd])
);

const issueState = new Map(
    (
        db.query(`SELECT issue, state FROM issue_meta`).all() as Array<{
            issue: number;
            state: string | null;
        }>
    )
        .filter((r): r is { issue: number; state: string } => r.state !== null)
        .map((r) => [r.issue, r.state])
);

db.close();

if (rows.length === 0) {
    console.error(`No LLM rows between ${from} and ${to}.`);
    process.exit(1);
}

const bySession = new Map<string, SessionConsumption>();
for (const r of rows) {
    let s = bySession.get(r.session);
    if (!s) {
        s = {
            session: r.session,
            cmd: sessionCmd.get(r.session) ?? null,
            units: 0,
            usd: 0,
            nonClaudeUsd: 0,
        };
        bySession.set(r.session, s);
    }
    const u = unitsOf(r.model, r.inTok, r.outTok, r.cacheRead, r.cacheWrite);
    const d = costOf(r.model, r.inTok, r.outTok, r.cacheRead, r.cacheWrite);
    // `unitsOf` returns 0 for a model that draws on no Claude allowance. Its
    // dollars are still real, so they are carried in their own field rather
    // than dropped — nothing in this report may vanish silently.
    if (u > 0) {
        s.units += u;
        s.usd += d;
    } else {
        s.nonClaudeUsd += d;
    }
}

const sessions = [...bySession.values()];
const issues = attributeIssues(sessions, issueState, allowance);

const attributedUnits = issues.reduce((a, r) => a + r.units, 0);
const totals: WindowTotals = {
    units: sessions.reduce((a, s) => a + s.units, 0),
    usd: sessions.reduce((a, s) => a + s.usd, 0),
    nonClaudeUsd: sessions.reduce((a, s) => a + s.nonClaudeUsd, 0),
    unattributedUnits: 0,
    days:
        Math.round(
            (Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) /
                86_400_000
        ) + 1,
};
totals.unattributedUnits = Math.max(0, totals.units - attributedUnits);

const cohortList = cohorts(issues);

if (asJson) {
    console.log(
        JSON.stringify(
            {
                from,
                to,
                targetPct: TARGET_PCT,
                allowance,
                totals,
                cohorts: cohortList.map((c) => ({
                    name: c.name,
                    issues: c.issues.length,
                })),
                issues: issues.slice(0, showIssues || issues.length),
            },
            null,
            2
        )
    );
} else {
    console.log(
        formatReport(from, to, totals, allowance, cohortList, TARGET_PCT)
    );
    if (showIssues > 0) {
        console.log("");
        console.log(`  costliest ${showIssues} issues in window`);
        for (const r of issues.slice(0, showIssues)) {
            console.log(
                `  #${String(r.issue).padEnd(5)} ${(r.units / 1e6)
                    .toFixed(1)
                    .padStart(7)}M units  ` +
                    `${(r.sharePct === null ? "n/a" : `${r.sharePct.toFixed(2)}%`).padStart(7)} of week  ` +
                    `list $${r.usd.toFixed(0).padStart(4)}  ` +
                    `${r.sessions} session${r.sessions === 1 ? "" : "s"}  ` +
                    `${r.state ?? "state unknown"}${r.nextIssue ? "  /next-issue" : ""}`
            );
        }
    }
}
