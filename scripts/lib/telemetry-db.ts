/**
 * Telemetry store — schema, pricing and derivation rules.
 *
 * The raw sources (`.claude/telemetry/tool-events.jsonl`, ~100MB and growing,
 * plus ~1.8GB of session transcripts under ~/.claude/projects/) are append-only
 * JSONL. Every consumer so far re-read them whole on every run, which is why
 * `agent-timing-report --scorecard` rescans the entire projects tree per
 * invocation. This module defines a SQLite mirror instead: ingest is
 * incremental (byte-offset cursor per file), and every query the dashboard asks
 * is a GROUP BY rather than a full parse.
 *
 * Two fact tables:
 *   spans — one row per completed tool call (pre/post paired by tool_use_id)
 *   llm   — one row per assistant message (the only place token usage lives)
 */

import type { Database } from "bun:sqlite";
import { createRequire } from "node:module";
import {
    DEFAULT_WEIGHTS,
    classifyModel,
    type CategoryWeights,
} from "./usage-window.ts";

// `bun:sqlite` is a Bun-only builtin with no Node equivalent. A type-only
// import keeps this module (and its pure pricing/classification helpers)
// importable under the Node vitest project; the runtime value is loaded lazily
// inside `openDb`, the only place that actually constructs a database — the
// same pattern `telemetry-serve.ts` uses.
const require = createRequire(import.meta.url);

export const SCHEMA = `
PRAGMA journal_mode = WAL;

-- One row per completed tool call. Durations come from pre/post timestamp
-- pairing; the hook stamps whole seconds, so sub-second spans read as 0.
CREATE TABLE IF NOT EXISTS spans (
    id          TEXT PRIMARY KEY,
    session     TEXT NOT NULL,
    harness     TEXT NOT NULL DEFAULT 'claude-code',
    ts          INTEGER NOT NULL,      -- epoch seconds (pre event)
    day         TEXT NOT NULL,         -- YYYY-MM-DD, local
    hour        INTEGER NOT NULL,      -- 0-23, local
    dur_s       REAL NOT NULL,
    tool        TEXT,                  -- Bash | Agent | Skill | Task
    kind        TEXT,                  -- gate:full | gate:check | gate:partial | subagent | skill | bash
    role        TEXT,                  -- implement | review | fixup | support | orchestrator | unclassified
    agent_type  TEXT,
    model_req   TEXT,                  -- model requested at spawn (null = inherited)
    skill       TEXT,
    cmd         TEXT,
    cmd_bucket  TEXT,                  -- gate | test | git | gh | bun | convex | fs | other
    bg          INTEGER
);
CREATE INDEX IF NOT EXISTS spans_day ON spans(day);
CREATE INDEX IF NOT EXISTS spans_session ON spans(session);

-- One row per assistant message, from the session transcripts. This is the
-- only source of real token counts: the hook payload carries usage on ~0.03%
-- of post events (29 of 102480 measured).
CREATE TABLE IF NOT EXISTS llm (
    uuid        TEXT PRIMARY KEY,
    session     TEXT NOT NULL,
    harness     TEXT NOT NULL DEFAULT 'claude-code',
    agent_id    TEXT,                  -- null for main-thread messages
    ts          INTEGER NOT NULL,
    day         TEXT NOT NULL,
    hour        INTEGER NOT NULL,
    model       TEXT NOT NULL,
    effort      TEXT,
    surface     TEXT NOT NULL,         -- main | sidechain | subagent
    agent_type  TEXT,
    role        TEXT,
    tool_use_id TEXT,                  -- links a subagent back to its spawn span
    in_tok      INTEGER NOT NULL,
    out_tok     INTEGER NOT NULL,
    cache_read  INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cost        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_day ON llm(day);
CREATE INDEX IF NOT EXISTS llm_model ON llm(model);
CREATE INDEX IF NOT EXISTS llm_session ON llm(session);
-- Without this the agent_runs rebuild's modal-model subquery scans the whole
-- llm table once per subagent (measured 87s vs 1s).
CREATE INDEX IF NOT EXISTS llm_agent ON llm(agent_id);

-- One row per subagent run, rebuilt from the llm table after every ingest.
--
-- The span for an Agent tool call is NOT a usable duration: a backgrounded
-- spawn returns "Async agent launched successfully" immediately, so its
-- pre/post pair measures the launch, not the run (measured mean 23.5s for
-- implement subagents that actually run for minutes). The transcript's
-- first-to-last message timestamps are the real wall clock.
CREATE TABLE IF NOT EXISTS agent_runs (
    agent_id    TEXT PRIMARY KEY,
    session     TEXT,
    harness     TEXT NOT NULL DEFAULT 'claude-code',
    started     INTEGER NOT NULL,
    day         TEXT NOT NULL,
    hour        INTEGER NOT NULL,
    dur_s       REAL NOT NULL,
    msgs        INTEGER NOT NULL,
    model       TEXT,
    agent_type  TEXT,
    role        TEXT,
    tool_use_id TEXT,
    in_tok      INTEGER NOT NULL,
    out_tok     INTEGER NOT NULL,
    cache_read  INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cost        REAL NOT NULL,
    parent_agent_id TEXT,              -- depth-2 spawns (investigate under implement)
    issue       INTEGER                -- GitHub issue this run worked, from its
                                       -- description's #N, inherited from the parent
);
CREATE INDEX IF NOT EXISTS agent_runs_day ON agent_runs(day);

-- Spawn metadata per subagent, read from subagents/*.meta.json. Kept separate
-- from agent_runs (which is rebuilt wholesale from llm) so the description and
-- parent edge survive rebuilds.
CREATE TABLE IF NOT EXISTS agent_meta (
    agent_id        TEXT PRIMARY KEY,
    description     TEXT,
    parent_agent_id TEXT,
    spawn_depth     INTEGER
);

-- One row per session, from the main transcript's event lines (custom-title,
-- last-prompt, pr-link). Wall clock and cost are derived from llm/spans at
-- query time, not stored.
CREATE TABLE IF NOT EXISTS sessions (
    session TEXT PRIMARY KEY,
    harness TEXT NOT NULL DEFAULT 'claude-code',
    title   TEXT,                      -- user-visible session title ("Emrakul")
    cmd     TEXT,                      -- first slash-command prompt seen
    prs     TEXT                       -- JSON array of distinct PR numbers
);

-- Issue metadata fetched from GitHub (family = area:* label). Open issues are
-- refreshed when stale; closed ones are final.
CREATE TABLE IF NOT EXISTS issue_meta (
    issue     INTEGER PRIMARY KEY,
    title     TEXT,
    family    TEXT,                    -- area label without the "area:" prefix
    state     TEXT,                    -- open | closed
    closed_at TEXT,
    fetched   INTEGER                  -- epoch seconds of last gh fetch
);

-- Byte-offset cursor per source file, so a re-run only parses the delta.
CREATE TABLE IF NOT EXISTS ingest_state (
    path   TEXT PRIMARY KEY,
    offset INTEGER NOT NULL,
    mtime  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`;

/**
 * USD per million tokens, base input / output, plus optional per-model cache
 * multipliers. Claude models fall back to the global defaults (cache reads at
 * ~0.1x input, cache writes at 1.25x — the 5-minute TTL default); DeepSeek
 * overrides them because its context-caching bills differently (cache miss =
 * full input price, cache hit ~3% of input).
 *
 * DeepSeek prices are the OFF-PEAK rates from the official pricing page
 * (https://api-docs.deepseek.com/quick_start/pricing), off-peak being the
 * majority of the clock: peak (01:00-04:00 / 06:00-10:00 UTC, Mon-Fri) is 2x.
 * $/1M tokens.
 */
type ModelPrice = {
    in: number;
    out: number;
    /** cache-read multiplier vs input; default CACHE_READ_MULT */
    cacheReadMult?: number;
    /** cache-write multiplier vs input; default CACHE_WRITE_MULT */
    cacheWriteMult?: number;
};

const PRICES: Record<string, ModelPrice> = {
    "claude-fable-5": { in: 10, out: 50 },
    "claude-mythos-5": { in: 10, out: 50 },
    "claude-opus-5": { in: 5, out: 25 },
    "claude-opus-4-8": { in: 5, out: 25 },
    "claude-opus-4-7": { in: 5, out: 25 },
    "claude-opus-4-6": { in: 5, out: 25 },
    "claude-opus-4-5": { in: 5, out: 25 },
    "claude-sonnet-5": { in: 3, out: 15 },
    "claude-sonnet-4-6": { in: 3, out: 15 },
    "claude-sonnet-4-5": { in: 3, out: 15 },
    "claude-haiku-4-5": { in: 1, out: 5 },
    // DeepSeek (off-peak): input = cache-miss rate, output = full rate.
    "deepseek-v4-pro": {
        in: 0.66,
        out: 1.98,
        cacheReadMult: 0.022 / 0.66,
        cacheWriteMult: 1,
    },
    "deepseek-v4-flash": {
        in: 0.22,
        out: 0.66,
        cacheReadMult: 0.007 / 0.22,
        cacheWriteMult: 1,
    },
    "deepseek-v4-flash-vision-exp": {
        in: 0.22,
        out: 0.66,
        cacheReadMult: 0.007 / 0.22,
        cacheWriteMult: 1,
    },
};

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

/**
 * Normalise a model id to a pricing key. Two shapes need stripping:
 * a `[1m]` long-context suffix (billed at standard rates — no long-context
 * premium on the 1M models) and a dated snapshot suffix.
 */
export function normalizeModel(raw: string): string {
    let m = raw.trim().replace(/\[1m\]$/i, "");
    m = m.replace(/-\d{8}$/, "");
    // Bare tier names appear when a spawn requested `model: sonnet`.
    if (m === "opus") return "claude-opus-5";
    if (m === "sonnet") return "claude-sonnet-5";
    if (m === "haiku") return "claude-haiku-4-5";
    if (m === "fable") return "claude-fable-5";
    return m;
}

export function costOf(
    model: string,
    inTok: number,
    outTok: number,
    cacheRead: number,
    cacheWrite: number
): number {
    const p = PRICES[normalizeModel(model)];
    if (!p) return 0;
    const M = 1_000_000;
    const readMult = p.cacheReadMult ?? CACHE_READ_MULT;
    const writeMult = p.cacheWriteMult ?? CACHE_WRITE_MULT;
    return (
        (inTok * p.in +
            outTok * p.out +
            cacheRead * p.in * readMult +
            cacheWrite * p.in * writeMult) /
        M
    );
}

// ─────────────────────────────────────────────────────────────────────────
// THE OTHER DENOMINATOR — allowance units, not list-price dollars.
//
// `costOf` above prices a row in USD at published API list price. That number
// compares two eras of this project against each other and nothing else: the
// work is not bought at list price, it is drawn against a subscription
// allowance, and ADR 0110's second target ("an issue costs <0.5% of the weekly
// budget") is stated in THAT currency. Issue #3080: the target had no
// denominator, so it had never been checked — while the incident that
// motivated it, 91% of a weekly allowance burnt in 48h, is precisely a
// denominator failure.
//
// The unit below is the one `scripts/lib/usage-window.ts` already defined for
// the AFK driver's budget guard (ADR 0097/0109): weighted tokens, anchored so
// 1 unit == 1 Sonnet input token. It is reused rather than re-derived — a
// second weight table would be a second answer to the same question, and the
// guard and the report must not be able to disagree. What is NOT reused is the
// budget: the guard's `TOLARIA_LOOP_TOKEN_BUDGET` is a per-pass window, the
// allowance here is weekly. Resolution of that value lives in exactly one
// place, `scripts/lib/telemetry-budget.ts`.
//
// Neither number is a quota reading. There is no supported way to read the
// real Anthropic allowance (ADR 0097); the weekly figure is user-declared, and
// every report that quotes a share says so.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Does this model draw on the CLAUDE weekly allowance?
 *
 * The store is not single-vendor: the opencode harness contributes DeepSeek
 * and Kimi rows (4.5k of them at time of writing), which cost real money and
 * draw on no Claude allowance at all. Counting them would inflate every share;
 * dropping them silently would lose them. So they are excluded HERE and
 * reported separately in list-price dollars by the budget report.
 *
 * The test is the normalised model family, not the harness: a Claude model
 * driven through another harness still bills the same account, and a
 * hypothetical non-Claude model driven through Claude Code still does not.
 * `<synthetic>` — Claude Code's own placeholder rows — falls outside too.
 */
export function drawsOnClaudeAllowance(model: string): boolean {
    return normalizeModel(model).startsWith("claude-");
}

/**
 * Allowance units consumed by one row — the weighted-token counterpart of
 * {@link costOf}, in the unit `usage-window.ts` anchors at "1 Sonnet input
 * token".
 *
 * Returns 0 for anything that does not draw on the Claude allowance, so a
 * caller summing this over a mixed store gets the allowance-relevant total and
 * nothing else. An unrecognised CLAUDE model keeps `classifyModel`'s
 * fail-expensive fallback (it prices as the most expensive class), because the
 * error this must never make is reporting a new model as cheap.
 */
export function unitsOf(
    model: string,
    inTok: number,
    outTok: number,
    cacheRead: number,
    cacheWrite: number,
    weights: Record<string, CategoryWeights> = DEFAULT_WEIGHTS
): number {
    if (!drawsOnClaudeAllowance(model)) return 0;
    const w = weights[classifyModel(model)];
    if (!w) return 0;
    return (
        inTok * w.input +
        outTok * w.output +
        cacheRead * w.cacheRead +
        cacheWrite * w.cacheCreation
    );
}

/** Roles are the prefix the spawn-guard hook requires on every `description`. */
const ROLE_PREFIXES = [
    "implement",
    "review",
    "re-review",
    "fixup",
    "investigate",
    "research",
    "verify",
    "migrate",
    "audit",
] as const;

const SUPPORT_ROLES = new Set([
    "investigate",
    "research",
    "verify",
    "migrate",
    "audit",
    "map",
    "locate",
    "find",
    "census",
    "convert",
]);

/**
 * Role bucketing. Mirrors `classifyRole` in scripts/lib/scorecard.ts, kept
 * separate because that one collapses everything non-Agent to `orchestrator`
 * and folds five distinct roles into `support` — useful for the loop scorecard,
 * too lossy for a dashboard meant to be split by role.
 */
export function classifyRole(tool: string | null, desc: string | null): string {
    if (tool !== "Agent" && tool !== "Task") return "orchestrator";
    const d = (desc ?? "").trimStart().toLowerCase();
    for (const p of ROLE_PREFIXES) {
        if (d.startsWith(p)) return p === "re-review" ? "review" : p;
    }
    const first = d.split(/[\s:]/)[0] ?? "";
    if (SUPPORT_ROLES.has(first)) return first;
    if (d.includes("review")) return "review";
    if (/\bfix ?up\b/.test(d)) return "fixup";
    if (/\bimplement\b/.test(d) || /#\d+/.test(d)) return "implement";
    return "unclassified";
}

const FULL_GATE =
    /\b(bun run test|bun run check:all|TOLARIA_ALLOW_FULL_SUITE)\b/;
// `check:lane` is the DEFAULT pre-PR path since #2738 and `land` runs it under
// the machine mutex before merging; both were bucketed as plain `bun` until
// issue #3079, which put the two single largest commands by wall time
// (334 min and 270 min over the 2026-08-28 baseline) outside the gate bucket
// entirely. `health:main` is the post-merge full gate ADR 0110 detached.
const CHECK_GATE =
    /\bbun run (check:(pr|guards|ts|index|stubs|lane|ui|docs)|land|health:main|docs:ship)\b/;
const PARTIAL_TEST =
    /\b(vitest run|bun run (test:(app|bot)|build)|tsc -b|eslint|prettier)\b/;

/** Span kind — the closest thing the raw telemetry has to a workflow stage. */
export function classifyKind(tool: string | null, cmd: string | null): string {
    if (tool === "Skill") return "skill";
    if (tool === "Agent" || tool === "Task") return "subagent";
    const c = cmd ?? "";
    if (FULL_GATE.test(c)) return "gate:full";
    if (CHECK_GATE.test(c)) return "gate:check";
    if (PARTIAL_TEST.test(c)) return "gate:partial";
    return "bash";
}

/** Coarse bucket for a Bash command, so the dashboard can split by what ran. */
export function bucketCmd(cmd: string | null): string | null {
    if (!cmd) return null;
    const c = cmd.trim();
    if (FULL_GATE.test(c) || CHECK_GATE.test(c)) return "gate";
    if (PARTIAL_TEST.test(c)) return "test";
    if (/^\s*gh\b/.test(c) || /\bgh (pr|issue|api|run|project)\b/.test(c))
        return "gh";
    if (
        /^\s*git\b/.test(c) ||
        /\bgit (add|commit|push|rebase|merge|worktree)\b/.test(c)
    )
        return "git";
    if (/\b(npx |bunx |convex )\b/.test(c)) return "convex";
    if (/^\s*(bun|npm|node) /.test(c)) return "bun";
    if (
        /^\s*(ls|cat|find|grep|rg|head|tail|wc|sed|awk|mkdir|rm|cp|mv)\b/.test(
            c
        )
    )
        return "fs";
    return "other";
}

export function openDb(path: string): Database {
    const { Database: SqliteDb } =
        require("bun:sqlite") as typeof import("bun:sqlite");
    const db = new SqliteDb(path, { create: true });
    db.exec(SCHEMA);
    // CREATE TABLE IF NOT EXISTS never widens an existing table — bring an
    // older DB up to the current agent_runs shape (idempotent, cheap).
    for (const ddl of [
        "ALTER TABLE agent_runs ADD COLUMN parent_agent_id TEXT",
        "ALTER TABLE agent_runs ADD COLUMN issue INTEGER",
        "ALTER TABLE spans ADD COLUMN harness TEXT NOT NULL DEFAULT 'claude-code'",
        "ALTER TABLE llm ADD COLUMN harness TEXT NOT NULL DEFAULT 'claude-code'",
        "ALTER TABLE agent_runs ADD COLUMN harness TEXT NOT NULL DEFAULT 'claude-code'",
        "ALTER TABLE sessions ADD COLUMN harness TEXT NOT NULL DEFAULT 'claude-code'",
    ]) {
        try {
            db.exec(ddl);
        } catch {
            /* column already exists */
        }
    }
    // After the widening — an index in SCHEMA would run before it on old DBs.
    db.exec("CREATE INDEX IF NOT EXISTS agent_runs_issue ON agent_runs(issue)");
    return db;
}

/**
 * Extract the GitHub ISSUE a spawn description refers to. Descriptions mix
 * issue and PR refs ("review annihilator PR #2316 (#2295)") — the issue is the
 * parenthesised ref when present, then an explicit "issue N", then any #N not
 * preceded by "PR". A PR-only description returns null (attribution then falls
 * back to the parent agent's issue, or stays unattributed).
 */
export function issueFromDescription(desc: string | null): number | null {
    if (!desc) return null;
    const paren = desc.match(/\(#(\d{2,5})\)/);
    if (paren) return Number(paren[1]);
    const word = desc.match(/\bissue[ #]+(\d{2,5})\b/i);
    if (word) return Number(word[1]);
    for (const m of desc.matchAll(/#(\d{2,5})\b/g)) {
        const before = desc.slice(Math.max(0, m.index! - 4), m.index);
        if (!/PR ?$/i.test(before)) return Number(m[1]);
    }
    return null;
}

/**
 * Extract the issue a SESSION is about, from its opening slash command.
 *
 * Deliberately stricter than {@link issueFromDescription}, which reads agent
 * spawn descriptions written to a known template. A session command is free
 * text a human typed (`/next-issue figli di 2064`,
 * `/process-gh-issues #2469 poi #2468`), so:
 *
 * - it must BE a slash command — an arbitrary prompt that happens to contain a
 *   number is not an issue claim;
 * - the number must STAND ALONE, not be a fragment of a longer token. A plain
 *   `\b` boundary reads `/mtg-rules-check 704.5a` as issue 704 and merges that
 *   session's whole cost into a real issue #704, inside the very cohort ADR
 *   0110's target is measured against. Dots and word characters on either side
 *   therefore disqualify a match, which also rejects CR ids (`605.1a`),
 *   versions (`1.3.9`), durations (`45m`) and dates (`2026-09-05` matches three
 *   times and so falls to the ambiguity rule below);
 * - it must name exactly ONE such number. Several is the legacy
 *   `/process-gh-issues` batch shape, where one session worked many issues and
 *   no split between them is recoverable; charging that session to whichever
 *   number came first would inflate that issue and erase the others.
 *
 * The residual risk is a slash command that takes a single bare argument in
 * issue range and does not mean an issue. It fails toward attributing, so it is
 * left to the report's coverage line rather than to a hand-maintained list of
 * command names, which rots open: a new numeric-argument skill would be
 * attributed anyway on the day it is added, and the list would then be a
 * guarantee nobody could rely on.
 *
 * This is what attributes MAIN-THREAD cost to an issue, which under ADR 0110 is
 * 87% of it (issue #3080) — `agent_runs.issue` only ever saw the subagent
 * remainder.
 */
export function issueFromSessionCommand(cmd: string | null): number | null {
    if (!cmd || !cmd.startsWith("/")) return null;
    const found = new Set<number>();
    for (const m of cmd.matchAll(/(?<![\w.])#?(\d{2,5})(?![\w.])/g))
        found.add(Number(m[1]));
    if (found.size !== 1) return null;
    return [...found][0];
}

/** Local-day and local-hour, matching how a human reads "when did this run". */
export function dayHour(tsSeconds: number): { day: string; hour: number } {
    const d = new Date(tsSeconds * 1000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
    ).padStart(2, "0")}`;
    return { day, hour: d.getHours() };
}
