/**
 * Who started a session — the AFK driver, or a person (issue #3144).
 *
 * The Now view's live-session list and its claimed-issue table both name a
 * session; neither could say whether an unattended pass
 * (`scripts/loop-drain.sh` → `claude -p`) or a human at a terminal was behind
 * it. That is the first question asked of a claim that looks stuck.
 *
 * TWO SIGNALS, IN PRECEDENCE ORDER, and the distinction between them is the
 * whole point of this module:
 *
 *   1. RECORDED — `.claude/hooks/session-origin.sh` runs INSIDE the session
 *      at `SessionStart` and writes one row per session to
 *      `.claude/telemetry/sessions.jsonl`, reading `TOLARIA_LOOP_DRAIN` — the
 *      variable `loop-drain.sh` exports on every pass it launches and
 *      `loop-handoff.sh` already trusts to know a pass was driver-started.
 *      Exact, because the hook shares the session's environment. Nothing can
 *      recover it afterwards: the variable dies with the process and the
 *      session UUID appears in no argv (the same dead end `loop-doctor.ts`
 *      documents for the claim→pid join).
 *
 *   2. INFERRED — the transcript's own `entrypoint` field, read by
 *      `lib/live-activity.ts`: `sdk-cli` for a headless `claude -p`, which is
 *      the shape the driver launches, and `cli` for an interactive terminal.
 *      This is what answers for every session that started before the hook
 *      existed. It IS an inference — a `claude -p` typed by hand reads as
 *      headless — so the reading carries its `source` and the dashboard says
 *      which one it got.
 *
 * Anything else reads `unknown`, never `interactive`: "we could not tell"
 * must not render as "a person did it". An unrecognised entrypoint (a future
 * `sdk-ts`, an IDE) is exactly that case — guessing it into one of the two
 * buckets is how a wrong badge ships silently.
 *
 * NOT `telemetry.db`, and not `tool-events.jsonl`. The Now view reads no
 * database by contract (PRD #2621 D1) and `tool-events.jsonl` is 215 MB;
 * this journal is an append-only JSONL of one short line per session, the
 * same shape and the same directory as `claims.jsonl`.
 */

import { readFileSync, statSync } from "node:fs";

export const SESSION_ORIGINS = ["afk", "interactive", "unknown"] as const;
export type SessionOrigin = (typeof SESSION_ORIGINS)[number];

/** How an origin was arrived at — the dashboard renders the difference. */
export type OriginSource = "ledger" | "entrypoint" | "none";

export interface OriginReading {
    origin: SessionOrigin;
    source: OriginSource;
}

/** The only recorded origins a ledger row may carry; anything else is a row
 *  from a future writer this reader does not understand, and is ignored
 *  rather than coerced. */
const RECORDED: ReadonlySet<string> = new Set(["afk", "interactive"]);

/**
 * Transcript `entrypoint` values, mapped. `sdk-cli` is what a `claude -p`
 * stamps — the invocation `loop-drain.sh` makes — and `cli` an interactive
 * terminal. Deliberately a CLOSED map: an unlisted value resolves to
 * `unknown`, so a new harness entrypoint appears as "not known" instead of
 * being silently filed under whichever bucket the fallback happened to be.
 */
export const ENTRYPOINT_ORIGIN: Readonly<Record<string, SessionOrigin>> = {
    "sdk-cli": "afk",
    cli: "interactive",
};

/** Where the session journal lives — the path the hook writes. */
export function originLedgerPath(
    root = process.env.CLAUDE_PROJECT_DIR ?? "."
): string {
    return `${root}/.claude/telemetry/sessions.jsonl`;
}

/**
 * Fold the journal's lines into `session → origin`. LAST ROW WINS: a session
 * id is reused when a session is resumed (`claude --resume`), and the most
 * recent start is the one that describes how it is running now.
 *
 * Pure — takes the file's text, so the test needs no filesystem. A malformed
 * line is skipped, never thrown on: this journal is written by a shell hook
 * that can be killed mid-append, and a half-written last line must not cost
 * the dashboard every row before it.
 */
export function parseOriginLedger(text: string): Map<string, SessionOrigin> {
    const out = new Map<string, SessionOrigin>();
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let row: { session?: unknown; origin?: unknown };
        try {
            row = JSON.parse(line) as typeof row;
        } catch {
            continue;
        }
        const session = row.session;
        const origin = row.origin;
        if (typeof session !== "string" || !session) continue;
        if (typeof origin !== "string" || !RECORDED.has(origin)) continue;
        out.set(session, origin as SessionOrigin);
    }
    return out;
}

/**
 * Combine the two signals for one session.
 *
 * The ledger wins whenever it has a row — it is a recording, the entrypoint
 * is a guess about the same fact. `entrypoint` answers for everything older
 * than the hook.
 */
export function resolveOrigin(
    recorded: SessionOrigin | undefined,
    entrypoint: string | null | undefined
): OriginReading {
    if (recorded) return { origin: recorded, source: "ledger" };
    const inferred = entrypoint ? ENTRYPOINT_ORIGIN[entrypoint] : undefined;
    if (inferred) return { origin: inferred, source: "entrypoint" };
    return { origin: "unknown", source: "none" };
}

/**
 * The journal, cached against its own size and mtime — re-read only when the
 * file actually moved. `/api/live` answers every ten seconds and the file
 * changes once per session start, so re-parsing it per request would be the
 * one avoidable read on that path.
 *
 * A missing or unreadable file is an EMPTY ledger, not an error: every
 * session then falls back to its entrypoint, which is the pre-#3144
 * behaviour and degrades to "inferred", never to a wrong badge.
 */
export class OriginLedger {
    private readonly path: string;
    private rows = new Map<string, SessionOrigin>();
    private size = -1;
    private mtimeMs = -1;

    constructor(path: string = originLedgerPath()) {
        this.path = path;
    }

    /** Re-read if the file moved. Cheap enough to call per request. */
    refresh(): void {
        let size: number;
        let mtimeMs: number;
        try {
            const st = statSync(this.path);
            size = st.size;
            mtimeMs = st.mtimeMs;
        } catch {
            this.rows = new Map();
            this.size = -1;
            this.mtimeMs = -1;
            return;
        }
        if (size === this.size && mtimeMs === this.mtimeMs) return;
        try {
            this.rows = parseOriginLedger(readFileSync(this.path, "utf8"));
        } catch {
            this.rows = new Map();
        }
        this.size = size;
        this.mtimeMs = mtimeMs;
    }

    /** The recorded origin of one session, or `undefined` when unrecorded. */
    recorded(session: string): SessionOrigin | undefined {
        return this.rows.get(session);
    }

    /** How many sessions the journal describes — the test's window on the
     *  cache, and what a diagnostic would print. */
    get count(): number {
        return this.rows.size;
    }
}
