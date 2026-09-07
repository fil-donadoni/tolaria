/**
 * Live activity from the session transcripts (issue #3135) — the Now view's
 * "what is happening right now" data, read STRAIGHT FROM `~/.claude/projects`
 * and never from `telemetry.db`.
 *
 * WHY NOT THE STORE. The Now view reads no database by contract (PRD #2621
 * D1): `telemetry.db` is rebuilt by `telemetry:ingest`, goes stale between
 * runs, and may not exist at all — and "tokens burnt in the last hour" is
 * exactly the number that is useless when it is an hour old. The transcripts
 * are the source `telemetry:ingest` itself reads, so reading them here is
 * the same fact at zero staleness, not a second opinion.
 *
 * THREE READS, ONE INDEX:
 *
 *   * ACTIVITY — assistant messages with a `usage` payload, bucketed by the
 *     local hour they were stamped in. Deduped by the API response id, the
 *     way `telemetry:ingest` learnt to (issue #3078): a response with several
 *     content blocks writes one transcript line per block and repeats its
 *     whole usage payload on each, so keying on the line would bill a
 *     three-block reply three times.
 *   * SESSIONS — one summary per main transcript touched inside the window:
 *     its title, its last prompt, the branch and cwd its lines carry, when it
 *     was last written to, and the tokens it spent inside the window.
 *   * MENTIONS — how often each transcript names an issue (`#3096`,
 *     `issue-3096`, `issue 3096`). That count is the whole issue → session
 *     mapping: a claim's row on the dashboard opens the transcript that
 *     talks about that issue the most, most recently. A heuristic, declared
 *     as one — the transcript does not know which issue it is working, and
 *     nothing on disk records the pairing.
 *
 * INCREMENTAL. Transcripts run to several MB each and a day touches ~50 of
 * them, so every refresh reads only the bytes appended since the last one
 * (a per-file byte cursor, the same shape as `readDelta` in
 * `telemetry-ingest.ts`), and a file whose size has not moved costs one
 * `stat`. The first refresh after boot pays the full window once.
 *
 * INJECTED ROOTS. `projectsRoot` and `projectSlug` are parameters, never
 * read from `homedir()` inside a function — the test suite points them at a
 * temp directory it wrote itself, and nothing here can wander into the
 * operator's real transcripts from a test.
 */

import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { costOf } from "./telemetry-db";

/** The Now view's own window — 24 hours, restated from
 *  `TIMELINE_WINDOW_HOURS` so this module does not depend on
 *  `lib/loop-status.ts` (issue #3131 retires most of that file). */
export const ACTIVITY_WINDOW_HOURS = 24;

/** A session that wrote to its transcript this recently is "live". */
export const LIVE_SESSION_MINUTES = 30;

/** Below this, a session is not merely live but ACTIVE — mid-turn. */
export const ACTIVE_SESSION_MINUTES = 3;

/** A session id is the transcript's basename: a UUID, and nothing else may
 *  reach the filesystem as one. */
export const SESSION_ID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const HOUR_MS = 3_600_000;

// ─────────────────────────────────────────────────────────────────────────────
// Transcript line shapes — the subset this module reads.
// ─────────────────────────────────────────────────────────────────────────────

interface Usage {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
}

interface ContentBlock {
    type?: string;
    text?: string;
    thinking?: string;
    name?: string;
    input?: unknown;
    tool_use_id?: string;
    content?: unknown;
    is_error?: boolean;
}

interface TranscriptLine {
    type?: string;
    uuid?: string;
    timestamp?: string;
    cwd?: string;
    gitBranch?: string;
    isMeta?: boolean;
    isSidechain?: boolean;
    customTitle?: string;
    lastPrompt?: string;
    level?: string;
    content?: unknown;
    message?: {
        id?: string;
        role?: string;
        model?: string;
        usage?: Usage;
        content?: string | ContentBlock[];
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Issue mentions — the issue → session heuristic.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every issue number a chunk of transcript text names. Three spellings,
 * because three producers: `#3096` (prose, PR bodies, `gh` output),
 * `issue-3096` (the worktree and branch names `wt:new` mints), and
 * `issue 3096` / `issue #3096` (the `/next-issue 3096` prompt and the
 * `issue #NNN` qualification CLAUDE.md mandates). 3–5 digits: this repo's
 * issue numbers, and short enough to exclude a PID or an epoch.
 */
export function issueMentions(text: string): Map<number, number> {
    const out = new Map<number, number>();
    const re = /(?:#|issue[- ]#?)(\d{3,5})\b/gi;
    for (const m of text.matchAll(re)) {
        const n = Number(m[1]);
        out.set(n, (out.get(n) ?? 0) + 1);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The index.
// ─────────────────────────────────────────────────────────────────────────────

interface FileCursor {
    offset: number;
    size: number;
    mtimeMs: number;
    /** Response ids already billed from this file (issue #3078's dedupe). */
    seen: Set<string>;
}

export interface HourBucket {
    /** Epoch ms of the local hour's start. */
    hourStart: number;
    inTok: number;
    outTok: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    messages: number;
}

export interface SessionSummary {
    session: string;
    /** The `~/.claude/projects/<dir>` the transcript lives in. */
    dir: string;
    title: string | null;
    lastPrompt: string | null;
    cwd: string | null;
    gitBranch: string | null;
    /** Epoch ms of the transcript's last write — liveness. */
    lastWriteMs: number;
    /** Epoch ms of the newest message stamped in it, or null. */
    lastMessageMs: number | null;
    outTok: number;
    inTok: number;
    cacheRead: number;
    cost: number;
    messages: number;
    /** Subagent transcripts under this session written in the window. */
    subagents: number;
    /** issue number → how often the transcript names it. */
    mentions: Record<number, number>;
}

const emptyBucket = (hourStart: number): HourBucket => ({
    hourStart,
    inTok: 0,
    outTok: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    messages: 0,
});

/** The local hour a timestamp falls in — its start, epoch ms. */
export function hourStartOf(ms: number): number {
    const d = new Date(ms);
    d.setMinutes(0, 0, 0);
    return d.getTime();
}

/**
 * Read `[offset, size)` of a file as text, trimmed back to the last complete
 * line. Returns the lines and the byte offset just past the last one, so a
 * half-written line (the harness appends one JSON object per line, and a
 * refresh can land mid-write) is re-read whole next time.
 */
export function readLinesFrom(
    path: string,
    offset: number,
    size: number
): { lines: string[]; nextOffset: number } {
    if (size <= offset) return { lines: [], nextOffset: offset };
    const buf = Buffer.alloc(size - offset);
    const fd = openSync(path, "r");
    let read = 0;
    try {
        read = readSync(fd, buf, 0, buf.length, offset);
    } finally {
        closeSync(fd);
    }
    const text = buf.subarray(0, read).toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return { lines: [], nextOffset: offset };
    const consumed = Buffer.byteLength(text.slice(0, lastNl + 1), "utf8");
    return {
        lines: text.slice(0, lastNl).split("\n").filter(Boolean),
        nextOffset: offset + consumed,
    };
}

/** The project directories a slug owns: the primary checkout's own and every
 *  worktree's (`<slug>-issue-N`, `<slug>-audit-N`, …). */
export function projectDirsOf(projectsRoot: string, slug: string): string[] {
    let names: string[];
    try {
        names = readdirSync(projectsRoot);
    } catch {
        return [];
    }
    return names
        .filter((n) => n === slug || n.startsWith(`${slug}-`))
        .map((n) => join(projectsRoot, n));
}

export interface LiveIndexOptions {
    projectsRoot: string;
    projectSlug: string;
    windowHours?: number;
}

/**
 * The in-memory index — one per server process. `refresh(nowMs)` walks the
 * project directories, reads what changed, and folds it into the buckets and
 * session summaries; every read below is a pure projection of that state.
 */
export class LiveIndex {
    private readonly projectsRoot: string;
    private readonly projectSlug: string;
    private readonly windowMs: number;
    private readonly cursors = new Map<string, FileCursor>();
    private readonly buckets = new Map<number, HourBucket>();
    private readonly sessions = new Map<string, SessionSummary>();
    /** session → hourStart → out tokens, so a session's in-window spend can
     *  be re-summed as the window slides. */
    private readonly sessionHours = new Map<
        string,
        Map<
            number,
            {
                outTok: number;
                inTok: number;
                cacheRead: number;
                cost: number;
                messages: number;
            }
        >
    >();
    private lastRefreshMs = 0;

    constructor(opts: LiveIndexOptions) {
        this.projectsRoot = opts.projectsRoot;
        this.projectSlug = opts.projectSlug;
        this.windowMs = (opts.windowHours ?? ACTIVITY_WINDOW_HOURS) * HOUR_MS;
    }

    /** When the index last walked the disk — surfaced as `asOf`. */
    get refreshedAt(): number {
        return this.lastRefreshMs;
    }

    /**
     * Walk every project directory, read appended bytes, fold them in.
     * Idempotent per byte: a line is folded exactly once, a response id
     * billed exactly once per file.
     */
    refresh(nowMs: number = Date.now()): void {
        const cutoff = nowMs - this.windowMs;
        for (const dir of projectDirsOf(this.projectsRoot, this.projectSlug)) {
            let entries: string[];
            try {
                entries = readdirSync(dir);
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (entry.endsWith(".jsonl")) {
                    const session = entry.slice(0, -".jsonl".length);
                    if (!SESSION_ID_RE.test(session)) continue;
                    this.readFile(
                        join(dir, entry),
                        dir,
                        session,
                        "main",
                        cutoff
                    );
                    continue;
                }
                if (!SESSION_ID_RE.test(entry)) continue;
                const subs = join(dir, entry, "subagents");
                let subFiles: string[];
                try {
                    subFiles = readdirSync(subs);
                } catch {
                    continue;
                }
                for (const f of subFiles) {
                    if (!f.endsWith(".jsonl")) continue;
                    this.readFile(
                        join(subs, f),
                        dir,
                        entry,
                        "subagent",
                        cutoff
                    );
                }
            }
        }
        this.prune(cutoff);
        this.lastRefreshMs = nowMs;
    }

    private readFile(
        path: string,
        dir: string,
        session: string,
        kind: "main" | "subagent",
        cutoffMs: number
    ): void {
        let size: number;
        let mtimeMs: number;
        try {
            const st = statSync(path);
            size = st.size;
            mtimeMs = st.mtimeMs;
        } catch {
            return;
        }
        // Outside the window and never seen: skip without opening it. A file
        // already indexed keeps being read to its end even as it ages out,
        // so the last lines of a session are never lost to the cutoff.
        const cursor = this.cursors.get(path);
        if (!cursor && mtimeMs < cutoffMs) return;

        const summary = this.sessionOf(session, dir);
        summary.lastWriteMs = Math.max(summary.lastWriteMs, mtimeMs);
        if (kind === "subagent" && !cursor) summary.subagents++;

        const cur = cursor ?? {
            offset: 0,
            size: 0,
            mtimeMs: 0,
            seen: new Set<string>(),
        };
        if (cur.offset > size) cur.offset = 0; // truncated or rotated
        if (cur.offset === size) {
            cur.mtimeMs = mtimeMs;
            this.cursors.set(path, cur);
            return;
        }
        const { lines, nextOffset } = readLinesFrom(path, cur.offset, size);
        for (const line of lines) this.foldLine(line, summary, cur.seen, kind);
        cur.offset = nextOffset;
        cur.size = size;
        cur.mtimeMs = mtimeMs;
        this.cursors.set(path, cur);
    }

    private sessionOf(session: string, dir: string): SessionSummary {
        let s = this.sessions.get(session);
        if (!s) {
            s = {
                session,
                dir,
                title: null,
                lastPrompt: null,
                cwd: null,
                gitBranch: null,
                lastWriteMs: 0,
                lastMessageMs: null,
                outTok: 0,
                inTok: 0,
                cacheRead: 0,
                cost: 0,
                messages: 0,
                subagents: 0,
                mentions: {},
            };
            this.sessions.set(session, s);
        }
        return s;
    }

    private foldLine(
        line: string,
        summary: SessionSummary,
        seen: Set<string>,
        kind: "main" | "subagent"
    ): void {
        // Mentions come off the RAW line: a tool result quoting `gh issue
        // view 3096` counts as much as prose does, which is what makes the
        // heuristic land on the session that is actually working the issue.
        for (const [issue, n] of issueMentions(line)) {
            summary.mentions[issue] = (summary.mentions[issue] ?? 0) + n;
        }
        let e: TranscriptLine;
        try {
            e = JSON.parse(line);
        } catch {
            return;
        }
        if (kind === "main") {
            if (e.type === "custom-title" && e.customTitle)
                summary.title = e.customTitle;
            if (e.type === "last-prompt" && typeof e.lastPrompt === "string")
                summary.lastPrompt = e.lastPrompt;
            if (e.cwd) summary.cwd = e.cwd;
            if (e.gitBranch) summary.gitBranch = e.gitBranch;
        }
        if (e.type !== "assistant") return;
        const msg = e.message;
        const usage = msg?.usage;
        if (!msg?.model || !usage) return;
        const ts = Date.parse(e.timestamp ?? "");
        if (!Number.isFinite(ts)) return;
        summary.lastMessageMs = Math.max(summary.lastMessageMs ?? 0, ts);
        const id = msg.id ?? e.uuid ?? null;
        if (id) {
            if (seen.has(id)) return;
            seen.add(id);
        }
        const inTok = usage.input_tokens ?? 0;
        const outTok = usage.output_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheWrite = usage.cache_creation_input_tokens ?? 0;
        const cost = costOf(msg.model, inTok, outTok, cacheRead, cacheWrite);
        const hour = hourStartOf(ts);

        const b = this.buckets.get(hour) ?? emptyBucket(hour);
        b.inTok += inTok;
        b.outTok += outTok;
        b.cacheRead += cacheRead;
        b.cacheWrite += cacheWrite;
        b.cost += cost;
        b.messages += 1;
        this.buckets.set(hour, b);

        let hours = this.sessionHours.get(summary.session);
        if (!hours) {
            hours = new Map();
            this.sessionHours.set(summary.session, hours);
        }
        const sh = hours.get(hour) ?? {
            outTok: 0,
            inTok: 0,
            cacheRead: 0,
            cost: 0,
            messages: 0,
        };
        sh.outTok += outTok;
        sh.inTok += inTok;
        sh.cacheRead += cacheRead;
        sh.cost += cost;
        sh.messages += 1;
        hours.set(hour, sh);
    }

    /** Drop buckets and sessions that slid out of the window, and re-sum
     *  every session's in-window totals. */
    private prune(cutoffMs: number): void {
        const hourCutoff = hourStartOf(cutoffMs);
        for (const hour of [...this.buckets.keys()]) {
            if (hour < hourCutoff) this.buckets.delete(hour);
        }
        for (const [session, s] of this.sessions) {
            if (s.lastWriteMs < cutoffMs) {
                this.sessions.delete(session);
                this.sessionHours.delete(session);
                continue;
            }
            const hours = this.sessionHours.get(session);
            s.outTok = 0;
            s.inTok = 0;
            s.cacheRead = 0;
            s.cost = 0;
            s.messages = 0;
            if (!hours) continue;
            for (const [hour, sh] of hours) {
                if (hour < hourCutoff) {
                    hours.delete(hour);
                    continue;
                }
                s.outTok += sh.outTok;
                s.inTok += sh.inTok;
                s.cacheRead += sh.cacheRead;
                s.cost += sh.cost;
                s.messages += sh.messages;
            }
        }
    }

    /**
     * One bucket per hour of the window, oldest first, EVERY hour present —
     * an hour with no messages is a zero bar, not a missing one: a gap in
     * the chart must mean "nothing happened", never "nothing was counted".
     */
    activity(nowMs: number = Date.now()): HourBucket[] {
        const windowHours = Math.round(this.windowMs / HOUR_MS);
        const last = hourStartOf(nowMs);
        const out: HourBucket[] = [];
        for (let i = windowHours - 1; i >= 0; i--) {
            const hour = last - i * HOUR_MS;
            out.push(this.buckets.get(hour) ?? emptyBucket(hour));
        }
        return out;
    }

    /** Every session touched in the window, most recently written first. */
    allSessions(): SessionSummary[] {
        return [...this.sessions.values()].sort(
            (a, b) => b.lastWriteMs - a.lastWriteMs
        );
    }

    /** Sessions written to within `LIVE_SESSION_MINUTES`. */
    liveSessions(nowMs: number = Date.now()): SessionSummary[] {
        const cutoff = nowMs - LIVE_SESSION_MINUTES * 60_000;
        return this.allSessions().filter((s) => s.lastWriteMs >= cutoff);
    }

    /**
     * The sessions most likely working `issue`, best first. A session that
     * never names the issue is not a candidate at all; among those that do,
     * LIVENESS comes first (a transcript being written to right now beats
     * one idle since this morning, however much the idle one talked about
     * the issue — measured on a real day: a planning conversation that
     * discussed issue #3048 forty times outranked the `/next-issue 3048`
     * session actually working it), then whether the branch or the first
     * prompt names the issue outright, then the mention count, then recency.
     * Capped at three; the drawer offers the rest as "+N more".
     */
    sessionsForIssue(
        issue: number,
        nowMs: number = Date.now(),
        limit = 3
    ): SessionSummary[] {
        const tier = (s: SessionSummary): number => {
            const ageMin = (nowMs - s.lastWriteMs) / 60_000;
            if (ageMin <= ACTIVE_SESSION_MINUTES) return 2;
            if (ageMin <= LIVE_SESSION_MINUTES) return 1;
            return 0;
        };
        const named = (s: SessionSummary): number =>
            (s.gitBranch ?? "").endsWith(`issue-${issue}`) ||
            new RegExp(`\\b${issue}\\b`).test(s.lastPrompt ?? "")
                ? 1
                : 0;
        return this.allSessions()
            .filter((s) => (s.mentions[issue] ?? 0) > 0)
            .sort(
                (a, b) =>
                    tier(b) - tier(a) ||
                    named(b) - named(a) ||
                    (b.mentions[issue] ?? 0) - (a.mentions[issue] ?? 0) ||
                    b.lastWriteMs - a.lastWriteMs
            )
            .slice(0, limit);
    }

    /** The summary for one session id, or null. */
    session(id: string): SessionSummary | null {
        return this.sessions.get(id) ?? null;
    }

    /** Resolve a session id to its main transcript's path — inside one of
     *  this slug's own project directories, or nowhere. */
    transcriptPath(id: string): string | null {
        if (!SESSION_ID_RE.test(id)) return null;
        for (const dir of projectDirsOf(this.projectsRoot, this.projectSlug)) {
            const p = join(dir, `${id}.jsonl`);
            try {
                if (statSync(p).isFile()) return p;
            } catch {
                /* not here */
            }
        }
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tail — a transcript as a person would read it in the terminal.
// ─────────────────────────────────────────────────────────────────────────────

export type TailKind =
    | "user"
    | "assistant"
    | "thinking"
    | "tool_use"
    | "tool_result"
    | "system";

export interface TailEntry {
    kind: TailKind;
    /** Epoch ms, or null when the line carried no timestamp. */
    ts: number | null;
    /** The body — a prompt, a reply, a tool's one-line summary, a result's
     *  head. Already truncated to `TAIL_TEXT_MAX`. */
    text: string;
    /** `tool_use` only: the tool's name. */
    tool?: string;
    /** `tool_result` only. */
    isError?: boolean;
}

/** Longest body a single entry carries to the page. */
export const TAIL_TEXT_MAX = 1200;
/** How many entries the first (offset-less) read of a tail returns. */
export const TAIL_INITIAL_ENTRIES = 200;
/** How far back the first read looks, in bytes. */
export const TAIL_INITIAL_BYTES = 512 * 1024;

const clip = (s: string, max = TAIL_TEXT_MAX): string =>
    s.length > max ? `${s.slice(0, max)}…` : s;

/**
 * One line summarising a tool call, the way the terminal's own tool line
 * reads: the command for Bash, the path for a file tool, the description or
 * skill name for the rest. Falls back to the input's keys so an unknown tool
 * still says SOMETHING rather than `[object Object]`.
 */
export function describeToolInput(name: string, input: unknown): string {
    if (!input || typeof input !== "object") return "";
    const i = input as Record<string, unknown>;
    const str = (k: string): string | null =>
        typeof i[k] === "string" ? (i[k] as string) : null;
    const desc = str("description");
    switch (name) {
        case "Bash":
            return str("command") ?? desc ?? "";
        case "Read":
        case "Write":
        case "Edit":
        case "NotebookEdit":
            return str("file_path") ?? "";
        case "Grep":
            return `${str("pattern") ?? ""}${str("path") ? ` in ${str("path")}` : ""}`;
        case "Glob":
            return str("pattern") ?? "";
        case "Agent":
            return desc ?? str("subagent_type") ?? "";
        case "Skill":
            return str("skill") ?? "";
        case "WebFetch":
            return str("url") ?? "";
        case "WebSearch":
            return str("query") ?? "";
        default:
            return desc ?? str("prompt") ?? Object.keys(i).join(", ");
    }
}

/** A tool result's content as text — a string, or text blocks joined. */
function resultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((c) =>
                c &&
                typeof c === "object" &&
                typeof (c as ContentBlock).text === "string"
                    ? (c as ContentBlock).text
                    : ""
            )
            .filter(Boolean)
            .join("\n");
    }
    return "";
}

/**
 * Transcript lines → the entries a tail shows. Lines that are not part of
 * the conversation (`file-history-snapshot`, `attachment`, `progress`, the
 * `isMeta` caveat lines the harness injects) are dropped; a `system` line
 * with a level is kept because that is where "context compacted" and the
 * hook errors land.
 */
export function parseTailEntries(lines: string[]): TailEntry[] {
    const out: TailEntry[] = [];
    for (const line of lines) {
        let e: TranscriptLine;
        try {
            e = JSON.parse(line);
        } catch {
            continue;
        }
        const ts = e.timestamp ? Date.parse(e.timestamp) : NaN;
        const at = Number.isFinite(ts) ? ts : null;
        if (e.type === "system") {
            const text = typeof e.content === "string" ? e.content : "";
            if (text) out.push({ kind: "system", ts: at, text: clip(text) });
            continue;
        }
        if (e.type !== "user" && e.type !== "assistant") continue;
        if (e.isMeta) continue;
        const content = e.message?.content;
        if (e.type === "user") {
            if (typeof content === "string") {
                if (content.trim())
                    out.push({ kind: "user", ts: at, text: clip(content) });
                continue;
            }
            for (const block of content ?? []) {
                if (block.type === "tool_result") {
                    out.push({
                        kind: "tool_result",
                        ts: at,
                        text: clip(resultText(block.content)),
                        isError: block.is_error === true,
                    });
                } else if (block.type === "text" && block.text?.trim()) {
                    out.push({ kind: "user", ts: at, text: clip(block.text) });
                }
            }
            continue;
        }
        // assistant
        if (typeof content === "string") {
            if (content.trim())
                out.push({ kind: "assistant", ts: at, text: clip(content) });
            continue;
        }
        for (const block of content ?? []) {
            if (block.type === "text" && block.text?.trim()) {
                out.push({ kind: "assistant", ts: at, text: clip(block.text) });
            } else if (block.type === "thinking" && block.thinking?.trim()) {
                out.push({
                    kind: "thinking",
                    ts: at,
                    text: clip(block.thinking, 300),
                });
            } else if (block.type === "tool_use") {
                const name = block.name ?? "tool";
                out.push({
                    kind: "tool_use",
                    ts: at,
                    tool: name,
                    text: clip(describeToolInput(name, block.input), 400),
                });
            }
        }
    }
    return out;
}

export interface TailPage {
    session: string;
    /** The file's size at read time — pass back as `offset` to get only
     *  what was appended since. */
    offset: number;
    /** Epoch ms of the file's last write. */
    lastWriteMs: number;
    entries: TailEntry[];
    /** True when the first read did not reach the file's beginning. */
    truncated: boolean;
}

/**
 * The page a tail client asks for: everything appended past `offset`, or —
 * with no offset — the last `TAIL_INITIAL_ENTRIES` entries of the file.
 * Never the whole file: a day-long session runs to several MB, and the
 * client wants where the conversation IS, not where it began.
 */
export function readTail(
    path: string,
    session: string,
    offset: number | null
): TailPage {
    const st = statSync(path);
    const size = st.size;
    if (offset !== null) {
        const from = Math.min(Math.max(0, offset), size);
        const { lines, nextOffset } = readLinesFrom(path, from, size);
        return {
            session,
            offset: nextOffset,
            lastWriteMs: st.mtimeMs,
            entries: parseTailEntries(lines),
            truncated: false,
        };
    }
    const from = Math.max(0, size - TAIL_INITIAL_BYTES);
    let { lines, nextOffset } = readLinesFrom(path, from, size);
    // A mid-file start lands inside a line: drop the partial head.
    if (from > 0 && lines.length > 0) lines = lines.slice(1);
    const entries = parseTailEntries(lines);
    return {
        session,
        offset: nextOffset,
        lastWriteMs: st.mtimeMs,
        entries: entries.slice(-TAIL_INITIAL_ENTRIES),
        truncated: from > 0 || entries.length > TAIL_INITIAL_ENTRIES,
    };
}
