/**
 * Incremental ingest of the raw telemetry into the SQLite mirror.
 *
 * Sources:
 *   .claude/telemetry/tool-events.jsonl        → spans (pre/post paired by id)
 *   ~/.claude/projects/<proj>/<session>.jsonl  → llm (main-thread messages)
 *   ~/.claude/projects/<proj>/<session>/subagents/agent-*.jsonl → llm (subagents)
 *
 * Each file carries a byte-offset cursor in `ingest_state`, so a re-run parses
 * only what was appended. A truncated or rotated file (size < stored offset)
 * resets its cursor and re-reads from zero.
 *
 * Usage: bun run telemetry:ingest [--reset]
 */

import {
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Database as Sqlite } from "bun:sqlite";
import {
    openDb,
    classifyKind,
    classifyRole,
    bucketCmd,
    costOf,
    dayHour,
    issueFromDescription,
    issueFromSessionCommand,
    normalizeModel,
} from "./lib/telemetry-db.ts";
import {
    OPENCODE_DB_PATH,
    projectIdFor,
    listSessions,
    listMessages,
} from "./lib/opencode-telemetry.ts";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const DB_PATH = join(PROJECT_DIR, ".claude/telemetry/telemetry.db");
const EVENTS = join(PROJECT_DIR, ".claude/telemetry/tool-events.jsonl");
const OPENCODE_EVENTS = join(
    PROJECT_DIR,
    ".opencode/telemetry/tool-events.jsonl"
);
const OPENCODE_FACTS = join(PROJECT_DIR, ".opencode/telemetry/facts.jsonl");
const PROJECTS_ROOT = join(homedir(), ".claude/projects");
const PROJECT_SLUG = PROJECT_DIR.replace(/\//g, "-");

/** Which harness wrote a source — the single fact that tags a row as its own. */
const HARNESS_CLAUDE = "claude-code";
const HARNESS_OPENCODE = "opencode";

/** A pre event waiting for its post — may straddle two ingest runs. */
interface PendingPre {
    ts: number;
    session: string;
    harness: string;
    tool: string | null;
    skill: string | null;
    desc: string | null;
    agentType: string | null;
    model: string | null;
    cmd: string | null;
    bg: number | null;
}

/**
 * Read the un-consumed tail of a file, stopping at the last complete line so a
 * concurrently-appending writer never leaves us with half a JSON object.
 */
async function readDelta(
    db: Sqlite,
    path: string
): Promise<{ lines: string[]; commit: () => void } | null> {
    let size: number;
    let mtime: number;
    try {
        const st = statSync(path);
        size = st.size;
        mtime = Math.floor(st.mtimeMs);
    } catch {
        return null;
    }

    const row = db
        .query<
            { offset: number },
            [string]
        >("SELECT offset FROM ingest_state WHERE path = ?")
        .get(path);
    let offset = row?.offset ?? 0;
    if (offset > size) offset = 0; // truncated or rotated
    if (offset === size) return null;

    const text = await Bun.file(path).slice(offset).text();
    const lastNl = text.lastIndexOf("\n");
    if (lastNl < 0) return null;
    const consumed = Buffer.byteLength(text.slice(0, lastNl + 1), "utf8");
    const lines = text.slice(0, lastNl).split("\n").filter(Boolean);

    return {
        lines,
        commit: () =>
            db.run(
                "INSERT OR REPLACE INTO ingest_state (path, offset, mtime) VALUES (?, ?, ?)",
                [path, offset + consumed, mtime]
            ),
    };
}

export async function ingestSpans(
    db: Sqlite,
    eventsPath: string,
    harness: string
): Promise<number> {
    const delta = await readDelta(db, eventsPath);
    if (!delta) return 0;

    // Pending pre-events survive between runs: a Bash call can straddle the
    // read boundary, and dropping it would silently lose the span.
    db.exec(
        "CREATE TABLE IF NOT EXISTS pending_pre (id TEXT PRIMARY KEY, payload TEXT NOT NULL)"
    );
    const pending = new Map<string, PendingPre>();
    for (const r of db
        .query<
            { id: string; payload: string },
            []
        >("SELECT id, payload FROM pending_pre")
        .all()) {
        pending.set(r.id, JSON.parse(r.payload));
    }

    const insert = db.prepare(
        `INSERT OR REPLACE INTO spans
         (id, session, harness, ts, day, hour, dur_s, tool, kind, role, agent_type, model_req, skill, cmd, cmd_bucket, bg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    let n = 0;
    db.transaction(() => {
        for (const line of delta.lines) {
            let e: Record<string, unknown>;
            try {
                e = JSON.parse(line);
            } catch {
                continue;
            }
            const id = e.id as string | null;
            if (!id) continue;

            if (e.phase === "pre") {
                pending.set(id, {
                    ts: e.ts as number,
                    session: (e.session as string) ?? "",
                    harness,
                    tool: (e.tool as string) ?? null,
                    skill: (e.skill as string) ?? null,
                    desc: (e.agent_desc as string) ?? null,
                    agentType: (e.agent_type as string) ?? null,
                    model: (e.model as string) ?? null,
                    cmd: (e.cmd as string) ?? null,
                    bg: e.bg ? 1 : 0,
                });
                continue;
            }

            const pre = pending.get(id);
            if (!pre) continue;
            pending.delete(id);

            const { day, hour } = dayHour(pre.ts);
            insert.run(
                id,
                pre.session,
                pre.harness,
                pre.ts,
                day,
                hour,
                Math.max(0, (e.ts as number) - pre.ts),
                pre.tool,
                classifyKind(pre.tool, pre.cmd),
                classifyRole(pre.tool, pre.desc),
                pre.agentType,
                pre.model,
                pre.skill,
                pre.cmd,
                bucketCmd(pre.cmd),
                pre.bg
            );
            n++;
        }

        db.run("DELETE FROM pending_pre");
        const p = db.prepare(
            "INSERT INTO pending_pre (id, payload) VALUES (?, ?)"
        );
        for (const [id, v] of pending) p.run(id, JSON.stringify(v));
        delta.commit();
    })();

    return n;
}

/** The subset of a transcript line this ingest reads. */
interface TranscriptLine {
    type?: string;
    uuid?: string;
    timestamp?: string;
    sessionId?: string;
    session_id?: string;
    effort?: string;
    isSidechain?: boolean;
    customTitle?: string;
    lastPrompt?: string;
    prNumber?: number;
    message?: {
        /**
         * The API response id. Several transcript lines share one when a
         * response has several content blocks (text, then tool_use), and each
         * of them carries the response's FULL usage payload — so this, not the
         * per-line `uuid`, is what identifies a billable response.
         */
        id?: string;
        model?: string;
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        };
    };
}

/**
 * Session narrative facts carried by non-assistant transcript lines. Applied
 * as an upsert so the delta pass and the one-time backfill compose.
 */
function applySessionEvent(
    db: Sqlite,
    session: string,
    e: TranscriptLine
): boolean {
    if (e.type === "custom-title" && e.customTitle) {
        db.run(
            `INSERT INTO sessions (session, title) VALUES (?, ?)
             ON CONFLICT(session) DO UPDATE SET title = excluded.title`,
            [session, e.customTitle]
        );
        return true;
    }
    if (
        e.type === "last-prompt" &&
        typeof e.lastPrompt === "string" &&
        e.lastPrompt.startsWith("/")
    ) {
        // Keep the FIRST slash command — it names what the session is for.
        db.run(
            `INSERT INTO sessions (session, cmd) VALUES (?, ?)
             ON CONFLICT(session) DO UPDATE SET cmd = coalesce(sessions.cmd, excluded.cmd)`,
            [session, e.lastPrompt]
        );
        return true;
    }
    if (e.type === "pr-link" && typeof e.prNumber === "number") {
        const row = db
            .query<
                { prs: string | null },
                [string]
            >("SELECT prs FROM sessions WHERE session = ?")
            .get(session);
        const prs: number[] = row?.prs ? JSON.parse(row.prs) : [];
        if (!prs.includes(e.prNumber)) prs.push(e.prNumber);
        db.run(
            `INSERT INTO sessions (session, prs) VALUES (?, ?)
             ON CONFLICT(session) DO UPDATE SET prs = excluded.prs`,
            [session, JSON.stringify(prs)]
        );
        return true;
    }
    return false;
}

interface SubagentMeta {
    agentType: string | null;
    description: string | null;
    toolUseId: string | null;
    model: string | null;
    parentAgentId: string | null;
    spawnDepth: number | null;
}

function readSubagentMeta(path: string): SubagentMeta {
    try {
        const m = JSON.parse(readFileSync(path, "utf8"));
        return {
            agentType: m.agentType ?? null,
            description: m.description ?? null,
            toolUseId: m.toolUseId ?? null,
            model: m.model ?? null,
            parentAgentId: m.parentAgentId ?? null,
            spawnDepth: m.spawnDepth ?? null,
        };
    } catch {
        return {
            agentType: null,
            description: null,
            toolUseId: null,
            model: null,
            parentAgentId: null,
            spawnDepth: null,
        };
    }
}

/**
 * Ingest assistant messages from one transcript. `surface` distinguishes the
 * main thread from a subagent's own file; sidechain messages inside a main
 * transcript are re-labelled so a split by surface doesn't conflate them.
 */
/** The session id is the main transcript's basename. */
function sessionOfPath(path: string): string {
    return path.replace(/^.*\//, "").replace(/\.jsonl$/, "");
}

async function ingestTranscript(
    db: Sqlite,
    path: string,
    surface: "main" | "subagent",
    meta: SubagentMeta | null,
    harness: string
): Promise<number> {
    const delta = await readDelta(db, path);
    if (!delta) return 0;

    const insert = db.prepare(
        `INSERT OR REPLACE INTO llm
         (uuid, session, harness, agent_id, ts, day, hour, model, effort, surface, agent_type, role, tool_use_id,
          in_tok, out_tok, cache_read, cache_write, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const agentId =
        surface === "subagent"
            ? (path.match(/agent-([0-9a-f]+)\.jsonl$/)?.[1] ?? null)
            : null;

    let n = 0;
    db.transaction(() => {
        for (const line of delta.lines) {
            let e: TranscriptLine;
            try {
                e = JSON.parse(line);
            } catch {
                continue;
            }
            if (e.type !== "assistant") {
                if (surface === "main")
                    applySessionEvent(db, sessionOfPath(path), e);
                continue;
            }
            const msg = e.message;
            const usage = msg?.usage;
            if (!msg?.model || !usage) continue;

            const ts = Math.floor(new Date(e.timestamp ?? 0).getTime() / 1000);
            if (!ts) continue;
            const { day, hour } = dayHour(ts);

            const model = normalizeModel(msg.model);
            const inTok = usage.input_tokens ?? 0;
            const outTok = usage.output_tokens ?? 0;
            const cRead = usage.cache_read_input_tokens ?? 0;
            const cWrite = usage.cache_creation_input_tokens ?? 0;

            // Key on the API response, NOT on the transcript line. A response
            // with several content blocks writes one line per block and repeats
            // its whole usage payload on each, so keying on `uuid` billed such
            // a response twice or more — 24895 main-thread rows for 15325
            // responses over 2026-08-28 -> 2026-09-05, inflating every cost
            // figure over this store by 42% (issue #3078). `INSERT OR REPLACE`
            // then collapses the repeats onto one row instead of accumulating
            // them. The `uuid` fallback keeps a line with no `message.id`
            // ingestable rather than silently dropped.
            insert.run(
                msg.id ?? e.uuid ?? `${path}:${n}`,
                e.sessionId ?? e.session_id ?? "",
                harness,
                agentId,
                ts,
                day,
                hour,
                model,
                e.effort ?? null,
                surface === "main" && e.isSidechain ? "sidechain" : surface,
                meta?.agentType ?? null,
                meta ? classifyRole("Agent", meta.description) : "orchestrator",
                meta?.toolUseId ?? null,
                inTok,
                outTok,
                cRead,
                cWrite,
                costOf(model, inTok, outTok, cRead, cWrite)
            );
            n++;
        }
        delta.commit();
    })();

    return n;
}

async function ingestTranscripts(db: Sqlite): Promise<number> {
    const root = join(PROJECTS_ROOT, PROJECT_SLUG);
    if (!existsSync(root)) return 0;

    let n = 0;
    for (const entry of readdirSync(root)) {
        const full = join(root, entry);

        if (entry.endsWith(".jsonl")) {
            n += await ingestTranscript(db, full, "main", null, HARNESS_CLAUDE);
            continue;
        }

        const subs = join(full, "subagents");
        if (!existsSync(subs)) continue;
        for (const f of readdirSync(subs)) {
            if (!f.endsWith(".jsonl")) continue;
            const metaPath = join(subs, f.replace(/\.jsonl$/, ".meta.json"));
            const meta = existsSync(metaPath)
                ? readSubagentMeta(metaPath)
                : null;
            if (meta) {
                const agentId = f
                    .replace(/^agent-/, "")
                    .replace(/\.jsonl$/, "");
                db.run(
                    `INSERT OR REPLACE INTO agent_meta
                     (agent_id, description, parent_agent_id, spawn_depth)
                     VALUES (?, ?, ?, ?)`,
                    [
                        agentId,
                        meta.description,
                        meta.parentAgentId,
                        meta.spawnDepth,
                    ]
                );
            }
            n += await ingestTranscript(
                db,
                join(subs, f),
                "subagent",
                meta,
                HARNESS_CLAUDE
            );
        }
    }
    return n;
}

/**
 * One-time sweep of the already-ingested part of every main transcript for
 * session narrative lines — the byte cursor is past them, so the delta pass
 * alone would only cover sessions created after this feature shipped.
 */
function backfillSessions(db: Sqlite): void {
    const done = db
        .query<
            { v: string },
            []
        >("SELECT v FROM meta WHERE k = 'sessions_backfill_v1'")
        .get();
    if (done) return;
    const root = join(PROJECTS_ROOT, PROJECT_SLUG);
    if (existsSync(root)) {
        for (const entry of readdirSync(root)) {
            if (!entry.endsWith(".jsonl")) continue;
            const session = entry.replace(/\.jsonl$/, "");
            const text = readFileSync(join(root, entry), "utf8");
            for (const line of text.split("\n")) {
                // Cheap substring gate before the JSON parse — most lines are
                // assistant/user messages this pass does not care about.
                if (
                    !line.includes('"custom-title"') &&
                    !line.includes('"last-prompt"') &&
                    !line.includes('"pr-link"')
                )
                    continue;
                try {
                    applySessionEvent(db, session, JSON.parse(line));
                } catch {
                    /* malformed line */
                }
            }
        }
    }
    db.run(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('sessions_backfill_v1', ?)",
        [String(Date.now())]
    );
}

/**
 * One-time collapse of the rows that one API response wrote before the insert
 * key moved from the transcript `uuid` to `message.id` (issue #3078).
 *
 * The byte cursors are past those lines, so an ordinary re-run never revisits
 * them and every historical figure would stay high. This re-reads the
 * transcripts for the ONE field that was thrown away — the response id — and
 * re-keys each row onto it. `UPDATE OR REPLACE` does the collapsing: the first
 * line of a response renames its row to the response id, and every later line
 * of the same response replaces that row rather than adding one. The rows carry
 * identical payloads, so which one survives does not matter.
 *
 * It is re-keyed rather than pattern-matched because the payload is NOT a safe
 * identity. Grouping by (session, model, all four counters) — the obvious
 * heuristic — merges rows measured **428578 seconds apart** in this very store:
 * two cheap responses in one long session collide on every counter without
 * being the same response. Only `message.id` actually says.
 *
 * `agent_runs` is rebuilt from `llm` on every ingest, so it corrects itself
 * once this has run.
 */
function backfillResponseIds(db: Sqlite): number {
    const done = db
        .query<
            { v: string },
            []
        >("SELECT v FROM meta WHERE k = 'llm_response_id_backfill_v1'")
        .get();
    if (done) return 0;

    const root = join(PROJECTS_ROOT, PROJECT_SLUG);
    const files: string[] = [];
    if (existsSync(root)) {
        for (const entry of readdirSync(root)) {
            const full = join(root, entry);
            if (entry.endsWith(".jsonl")) {
                files.push(full);
                continue;
            }
            const subs = join(full, "subagents");
            if (!existsSync(subs)) continue;
            for (const f of readdirSync(subs))
                if (f.endsWith(".jsonl")) files.push(join(subs, f));
        }
    }

    // Only rows this store actually holds are worth a statement, and the set
    // doubles as the guard against re-keying a row that is already correct.
    const known = new Set(
        db
            .query<{ uuid: string }, []>("SELECT uuid FROM llm")
            .all()
            .map((r) => r.uuid)
    );
    const before = db
        .query<{ n: number }, []>("SELECT count(*) AS n FROM llm")
        .get()!.n;

    const rekey = db.prepare(
        "UPDATE OR REPLACE llm SET uuid = ? WHERE uuid = ?"
    );
    db.transaction(() => {
        for (const file of files) {
            let text: string;
            try {
                text = readFileSync(file, "utf8");
            } catch {
                continue;
            }
            for (const line of text.split("\n")) {
                // Cheap substring gate before the parse — a transcript is
                // mostly lines this pass has no use for.
                if (!line.includes('"assistant"') || !line.includes('"msg_'))
                    continue;
                let e: TranscriptLine;
                try {
                    e = JSON.parse(line);
                } catch {
                    continue;
                }
                const id = e.message?.id;
                const uuid = e.uuid;
                if (!id || !uuid || id === uuid || !known.has(uuid)) continue;
                rekey.run(id, uuid);
                known.delete(uuid);
                known.add(id);
            }
        }
    })();

    const after = db
        .query<{ n: number }, []>("SELECT count(*) AS n FROM llm")
        .get()!.n;
    db.run(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('llm_response_id_backfill_v1', ?)",
        [String(Date.now())]
    );
    return before - after;
}

/**
 * Re-run `classifyKind` / `bucketCmd` over every stored span whenever the
 * classifier changes (issue #3079).
 *
 * Both columns are computed at INSERT time and the byte cursors mean an
 * ordinary re-run never revisits a line, so widening what counts as a gate
 * would otherwise only reach rows ingested afterwards — and the dashboard
 * groups on both columns (`telemetry-serve.ts` § DIMENSIONS.spans), so the
 * same command would read as two different buckets either side of the day the
 * classifier changed. That split-brain is worse than either classification.
 *
 * **Bump `SPAN_CLASSIFIER_VERSION` in the same commit as any change to
 * `classifyKind` or `bucketCmd`.** The pass is a full scan of `spans` (208k
 * rows, ~1s) and writes only the rows whose classification actually moved, so
 * paying it on a version bump costs nothing worth optimising.
 */
const SPAN_CLASSIFIER_VERSION = 2;

function reclassifySpans(db: Sqlite): number {
    const done = db
        .query<
            { v: string },
            []
        >("SELECT v FROM meta WHERE k = 'span_classifier_version'")
        .get();
    if (done?.v === String(SPAN_CLASSIFIER_VERSION)) return 0;

    const rows = db
        .query<
            {
                id: string;
                tool: string | null;
                cmd: string | null;
                kind: string | null;
                cmd_bucket: string | null;
            },
            []
        >("SELECT id, tool, cmd, kind, cmd_bucket FROM spans")
        .all();

    const upd = db.prepare(
        "UPDATE spans SET kind = ?, cmd_bucket = ? WHERE id = ?"
    );
    let changed = 0;
    db.transaction(() => {
        for (const r of rows) {
            const kind = classifyKind(r.tool, r.cmd);
            const bucket = r.tool === "Bash" ? bucketCmd(r.cmd) : r.cmd_bucket;
            if (kind === r.kind && bucket === r.cmd_bucket) continue;
            upd.run(kind, bucket, r.id);
            changed++;
        }
    })();

    db.run(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('span_classifier_version', ?)",
        [String(SPAN_CLASSIFIER_VERSION)]
    );
    return changed;
}

/**
 * Attribute each agent run to a GitHub issue: its own description's issue ref,
 * else the parent's (an investigate spawned inside an implement works that
 * implement's issue). PR-only descriptions stay unattributed.
 */
function attributeIssues(db: Sqlite): number {
    const metas = db
        .query<
            {
                agent_id: string;
                description: string | null;
                parent_agent_id: string | null;
            },
            []
        >("SELECT agent_id, description, parent_agent_id FROM agent_meta")
        .all();
    const direct = new Map<string, number>();
    for (const m of metas) {
        const n = issueFromDescription(m.description);
        if (n !== null) direct.set(m.agent_id, n);
    }
    const parentOf = new Map(metas.map((m) => [m.agent_id, m.parent_agent_id]));
    const upd = db.prepare(
        "UPDATE agent_runs SET issue = ?, parent_agent_id = ? WHERE agent_id = ?"
    );
    let attributed = 0;
    db.transaction(() => {
        for (const m of metas) {
            let issue: number | null = direct.get(m.agent_id) ?? null;
            // Walk up the spawn chain (bounded — depth is ≤3 in practice).
            let cursor = m.parent_agent_id;
            for (let hop = 0; issue === null && cursor && hop < 4; hop++) {
                issue = direct.get(cursor) ?? null;
                cursor = parentOf.get(cursor) ?? null;
            }
            upd.run(issue, m.parent_agent_id, m.agent_id);
            if (issue !== null) attributed++;
        }
    })();
    return attributed;
}

/**
 * Fetch family (area:* label), state and title for issues the runs reference.
 * Missing issues are fetched once; open ones are refreshed after 6h (labels
 * and state change); closed ones are final. Offline ⇒ silently skipped.
 */
function refreshIssueMeta(db: Sqlite): number {
    const now = Math.floor(Date.now() / 1000);
    // Two sources of issue numbers, not one. `agent_runs.issue` is the subagent
    // side, and under ADR 0110 there is barely a subagent left to read: the
    // issue a session worked now lives in its opening slash command, and 87% of
    // the cost is main-thread. Fetching only the agent_runs side left the
    // per-issue budget report (issue #3080) unable to say whether an issue was
    // even closed — 20 of 57 `/next-issue` issues had a row. Session-named
    // issues are stubbed with a NULL state so the fetch loop below claims them;
    // a number that turns out not to be an issue is stamped 'unknown' by the
    // 404 branch and stops eating fetch slots, exactly as a misread PR ref does.
    const stub = db.prepare(
        `INSERT INTO issue_meta (issue, title, family, state, closed_at, fetched)
         VALUES (?, NULL, NULL, NULL, NULL, 0)
         ON CONFLICT(issue) DO NOTHING`
    );
    db.transaction(() => {
        for (const { cmd } of db
            .query<
                { cmd: string | null },
                []
            >("SELECT DISTINCT cmd FROM sessions WHERE cmd IS NOT NULL")
            .all()) {
            const issue = issueFromSessionCommand(cmd);
            if (issue !== null) stub.run(issue);
        }
    })();

    const wanted = db
        .query<{ issue: number }, [number]>(
            `SELECT DISTINCT src.issue AS issue FROM (
                 SELECT r.issue AS issue FROM agent_runs r WHERE r.issue IS NOT NULL
                 UNION
                 SELECT m0.issue AS issue FROM issue_meta m0
             ) src
             LEFT JOIN issue_meta m ON m.issue = src.issue
             WHERE m.issue IS NULL
                OR m.state IS NULL
                OR (m.state = 'open' AND m.fetched < ?)
             -- Session-sourced stubs now share this 60-per-run cap with the
             -- agent_runs side, and an unordered LIMIT would pick an arbitrary
             -- 60 of them each run — a real open issue's state refresh could be
             -- crowded out indefinitely by whichever rows the planner happened
             -- to reach. Newest first: a report is about recent work, and the
             -- order is at least deterministic.
             ORDER BY src.issue DESC
             LIMIT 60`
        )
        .all(now - 6 * 3600);
    if (!wanted.length) return 0;

    let repo = db
        .query<{ v: string }, []>("SELECT v FROM meta WHERE k = 'gh_repo'")
        .get()?.v;
    if (!repo) {
        const cleanEnv = { ...process.env };
        delete cleanEnv.GITHUB_TOKEN; // see refresh loop below
        const p = Bun.spawnSync(
            [
                "gh",
                "repo",
                "view",
                "--json",
                "nameWithOwner",
                "-q",
                ".nameWithOwner",
            ],
            { env: cleanEnv }
        );
        repo = p.success ? p.stdout.toString().trim() : "";
        if (!repo) return 0;
        db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('gh_repo', ?)", [
            repo,
        ]);
    }

    const put = db.prepare(
        `INSERT OR REPLACE INTO issue_meta (issue, title, family, state, closed_at, fetched)
         VALUES (?, ?, ?, ?, ?, ?)`
    );
    // Bun auto-loads .env.local, whose limited-scope GITHUB_TOKEN shadows the
    // gh keyring auth and 403s the API — strip it from the child env.
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    let n = 0;
    for (const { issue } of wanted) {
        const p = Bun.spawnSync(
            ["gh", "api", `repos/${repo}/issues/${issue}`],
            { env }
        );
        if (!p.success) {
            // Distinguish "gh is offline" (retry next ingest) from "the number
            // is not an issue" (a 404/gone — often a PR number misread as an
            // issue ref): stub the latter so it stops eating fetch slots.
            const err = p.stderr.toString();
            if (/HTTP 404|Not Found|gone/i.test(err)) {
                put.run(issue, null, null, "unknown", null, now);
            }
            continue;
        }
        try {
            const j = JSON.parse(p.stdout.toString());
            const family =
                (j.labels ?? [])
                    .map((l: { name?: string }) => l.name ?? "")
                    .find((s: string) => s.startsWith("area:"))
                    ?.slice(5) ?? null;
            put.run(
                issue,
                j.title ?? null,
                family,
                // The issues API also answers for PR numbers — a description
                // whose #N was really a PR gets stamped 'pr', so issue views
                // can exclude it instead of showing a phantom issue.
                j.pull_request ? "pr" : (j.state ?? null),
                j.closed_at ?? null,
                now
            );
            n++;
        } catch {
            /* malformed response */
        }
    }
    return n;
}

const reset = process.argv.includes("--reset");
if (reset && existsSync(DB_PATH)) {
    rmSync(DB_PATH, { force: true });
    for (const suffix of ["-wal", "-shm"]) {
        const p = DB_PATH + suffix;
        if (existsSync(p)) rmSync(p, { force: true });
    }
}

/**
 * Rebuild the per-subagent rollup. Cheap enough to redo wholesale (one GROUP BY
 * over the `llm` table) and it must be redone anyway: a run's last message can
 * arrive in a later ingest, which changes its duration and totals.
 */
function rebuildAgentRuns(db: Sqlite): number {
    db.run("DELETE FROM agent_runs");
    db.run(`
        INSERT INTO agent_runs
        (agent_id, session, harness, started, day, hour, dur_s, msgs, model, agent_type,
         role, tool_use_id, in_tok, out_tok, cache_read, cache_write, cost)
        SELECT
            l.agent_id,
            max(l.session),
            max(l.harness),
            min(l.ts),
            '',
            0,
            max(l.ts) - min(l.ts),
            count(*),
            -- The model can change mid-run only via a fallback; the modal value
            -- is what the run is attributed to.
            (SELECT model FROM llm x WHERE x.agent_id = l.agent_id
             GROUP BY model ORDER BY count(*) DESC LIMIT 1),
            max(l.agent_type),
            max(l.role),
            max(l.tool_use_id),
            sum(l.in_tok), sum(l.out_tok), sum(l.cache_read), sum(l.cache_write), sum(l.cost)
        FROM llm l
        WHERE l.surface = 'subagent' AND l.agent_id IS NOT NULL
        GROUP BY l.agent_id
    `);
    // day/hour are local-time derivations the SQL layer can't do portably.
    const rows = db
        .query<
            { agent_id: string; started: number },
            []
        >("SELECT agent_id, started FROM agent_runs")
        .all();
    const upd = db.prepare(
        "UPDATE agent_runs SET day = ?, hour = ? WHERE agent_id = ?"
    );
    db.transaction(() => {
        for (const r of rows) {
            const { day, hour } = dayHour(r.started);
            upd.run(day, hour, r.agent_id);
        }
    })();
    return rows.length;
}

/**
 * Mirror opencode's session store into the SQLite mirror, tagged
 * harness='opencode'. Incremental via an `opencode_last_ms` watermark on
 * message.time_created; sessions are few, so they are re-listed each run.
 * Reads opencode.db read-only and degrades to a no-op when it is absent or the
 * project has no directory row.
 */
export function ingestOpencode(
    db: Sqlite,
    directory: string,
    opencodeDbPath: string
): {
    sessions: number;
    llm: number;
    runs: number;
} {
    if (!existsSync(opencodeDbPath)) return { sessions: 0, llm: 0, runs: 0 };
    let oc: Sqlite;
    try {
        oc = new Sqlite(opencodeDbPath, { readonly: true });
    } catch {
        return { sessions: 0, llm: 0, runs: 0 };
    }

    const projectId = projectIdFor(oc, directory);
    if (!projectId) {
        oc.close();
        return { sessions: 0, llm: 0, runs: 0 };
    }

    const sessions = listSessions(oc, projectId);
    if (sessions.length === 0) {
        oc.close();
        return { sessions: 0, llm: 0, runs: 0 };
    }

    const lastMs = Number(
        db
            .query<
                { v: string },
                []
            >("SELECT v FROM meta WHERE k = 'opencode_last_ms'")
            .get()?.v ?? 0
    );

    const insertLlm = db.prepare(
        `INSERT OR REPLACE INTO llm
         (uuid, session, harness, agent_id, ts, day, hour, model, effort, surface, agent_type, role, tool_use_id,
          in_tok, out_tok, cache_read, cache_write, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertSession = db.prepare(
        `INSERT INTO sessions (session, harness, title) VALUES (?, ?, ?)
         ON CONFLICT(session) DO UPDATE SET title = excluded.title, harness = excluded.harness`
    );

    let nLlm = 0;
    let nSessions = 0;
    let maxMs = lastMs;

    db.transaction(() => {
        for (const s of sessions) {
            const surface: "main" | "subagent" = s.parentId
                ? "subagent"
                : "main";
            const mainSessionId = s.parentId ?? s.id;
            const agentType = surface === "subagent" ? s.agent : null;

            if (surface === "main") {
                insertSession.run(s.id, HARNESS_OPENCODE, s.title);
                nSessions++;
            }

            const msgs = listMessages(oc, s.id, lastMs, {
                mainSessionId,
                surface,
                agentType,
                fallbackModelId: s.modelId,
            });
            for (const m of msgs) {
                const model = normalizeModel(m.modelId ?? "");
                if (!model) continue;
                const ts = Math.floor(m.tsMs / 1000);
                if (!ts) continue;
                const { day, hour } = dayHour(ts);
                insertLlm.run(
                    `oc:${s.id}:${m.id}`,
                    m.mainSessionId,
                    HARNESS_OPENCODE,
                    surface === "subagent" ? s.id : null,
                    ts,
                    day,
                    hour,
                    model,
                    null,
                    m.surface,
                    m.agentType,
                    surface === "subagent"
                        ? classifyRole("Agent", s.title)
                        : "orchestrator",
                    null,
                    m.inTok,
                    m.outTok,
                    m.cacheRead,
                    m.cacheWrite,
                    costOf(model, m.inTok, m.outTok, m.cacheRead, m.cacheWrite)
                );
                nLlm++;
                if (m.tsMs > maxMs) maxMs = m.tsMs;
            }
        }
    })();

    db.run(
        "INSERT OR REPLACE INTO meta (k, v) VALUES ('opencode_last_ms', ?)",
        [String(maxMs)]
    );

    // Spawn metadata for subagent runs — description is the auto-generated
    // title ("Review PR #1048 (@general subagent)"), which carries the role and
    // the issue/PR refs that attributeIssues() and the dashboard read.
    const parentOf = new Map(sessions.map((s) => [s.id, s.parentId]));
    const depthOf = (id: string): number => {
        let depth = 0;
        let cur: string | null = parentOf.get(id) ?? null;
        while (cur && depth < 8) {
            depth++;
            cur = parentOf.get(cur) ?? null;
        }
        return depth;
    };
    let runs = 0;
    for (const s of sessions) {
        if (!s.parentId) continue;
        db.run(
            `INSERT OR REPLACE INTO agent_meta
             (agent_id, description, parent_agent_id, spawn_depth)
             VALUES (?, ?, ?, ?)`,
            [s.id, s.title, s.parentId, depthOf(s.id)]
        );
        runs++;
    }

    oc.close();
    return { sessions: nSessions, llm: nLlm, runs };
}

/**
 * PR facts written by the opencode telemetry plugin
 * (`.opencode/telemetry/facts.jsonl`): one `pr-link` line per PR the session
 * created or landed. Upserts into `sessions.prs` so the harness comparison has
 * the same outcome signal Claude Code records via its `pr-link` transcript
 * events.
 */
export async function ingestOpencodeFacts(
    db: Sqlite,
    factsPath: string
): Promise<number> {
    const delta = await readDelta(db, factsPath);
    if (!delta) return 0;
    let n = 0;
    db.transaction(() => {
        for (const line of delta.lines) {
            let e: Record<string, unknown>;
            try {
                e = JSON.parse(line);
            } catch {
                continue;
            }
            if (e.event !== "pr-link") continue;
            const session = e.session as string | undefined;
            const pr = Number(e.pr);
            if (!session || !Number.isInteger(pr)) continue;
            const row = db
                .query<
                    { prs: string | null },
                    [string]
                >("SELECT prs FROM sessions WHERE session = ?")
                .get(session);
            const prs: number[] = row?.prs ? JSON.parse(row.prs) : [];
            if (!prs.includes(pr)) prs.push(pr);
            db.run(
                `INSERT INTO sessions (session, harness, prs) VALUES (?, ?, ?)
                 ON CONFLICT(session) DO UPDATE SET prs = excluded.prs`,
                [session, HARNESS_OPENCODE, JSON.stringify(prs)]
            );
            n++;
        }
        delta.commit();
    })();
    return n;
}

async function main(): Promise<void> {
    const db = openDb(DB_PATH);
    const t0 = Date.now();
    const spans = await ingestSpans(db, EVENTS, HARNESS_CLAUDE);
    const opencodeSpans = await ingestSpans(
        db,
        OPENCODE_EVENTS,
        HARNESS_OPENCODE
    );
    const msgs = await ingestTranscripts(db);
    backfillSessions(db);
    const oc = ingestOpencode(db, PROJECT_DIR, OPENCODE_DB_PATH);
    const ocFacts = await ingestOpencodeFacts(db, OPENCODE_FACTS);
    // Before the agent_runs rebuild, which reads straight off `llm`.
    const deduped = backfillResponseIds(db);
    const reclassified = reclassifySpans(db);
    const runs = rebuildAgentRuns(db);
    const attributed = attributeIssues(db);
    const fetched = refreshIssueMeta(db);
    db.run("INSERT OR REPLACE INTO meta (k, v) VALUES ('last_ingest', ?)", [
        String(Date.now()),
    ]);

    const totals = db
        .query<
            { spans: number; llm: number },
            []
        >("SELECT (SELECT count(*) FROM spans) AS spans, (SELECT count(*) FROM llm) AS llm")
        .get()!;

    console.log(
        `ingested +${spans} claude spans, +${opencodeSpans} opencode spans, +${msgs} claude messages ` +
            `(+${oc.llm} opencode messages, ${oc.sessions} sessions, ${oc.runs} runs, ${ocFacts} pr facts) ` +
            `in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
            `(total ${totals.spans} spans, ${totals.llm} messages, ${runs} agent runs, ` +
            (deduped ? `${deduped} duplicate response rows collapsed, ` : "") +
            (reclassified ? `${reclassified} spans reclassified, ` : "") +
            `${attributed} issue-attributed, +${fetched} issue metas) → ${DB_PATH}`
    );
    db.close();
}

if (import.meta.main) await main();
