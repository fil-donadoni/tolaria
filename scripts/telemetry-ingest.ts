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
import type { Database } from "bun:sqlite";
import {
    openDb,
    classifyKind,
    classifyRole,
    bucketCmd,
    costOf,
    dayHour,
    normalizeModel,
} from "./lib/telemetry-db.ts";

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const DB_PATH = join(PROJECT_DIR, ".claude/telemetry/telemetry.db");
const EVENTS = join(PROJECT_DIR, ".claude/telemetry/tool-events.jsonl");
const PROJECTS_ROOT = join(homedir(), ".claude/projects");
const PROJECT_SLUG = PROJECT_DIR.replace(/\//g, "-");

/** A pre event waiting for its post — may straddle two ingest runs. */
interface PendingPre {
    ts: number;
    session: string;
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
    db: Database,
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

async function ingestSpans(db: Database): Promise<number> {
    const delta = await readDelta(db, EVENTS);
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
         (id, session, ts, day, hour, dur_s, tool, kind, role, agent_type, model_req, skill, cmd, cmd_bucket, bg)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    message?: {
        model?: string;
        usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
        };
    };
}

interface SubagentMeta {
    agentType: string | null;
    description: string | null;
    toolUseId: string | null;
    model: string | null;
}

function readSubagentMeta(path: string): SubagentMeta {
    try {
        const m = JSON.parse(readFileSync(path, "utf8"));
        return {
            agentType: m.agentType ?? null,
            description: m.description ?? null,
            toolUseId: m.toolUseId ?? null,
            model: m.model ?? null,
        };
    } catch {
        return {
            agentType: null,
            description: null,
            toolUseId: null,
            model: null,
        };
    }
}

/**
 * Ingest assistant messages from one transcript. `surface` distinguishes the
 * main thread from a subagent's own file; sidechain messages inside a main
 * transcript are re-labelled so a split by surface doesn't conflate them.
 */
async function ingestTranscript(
    db: Database,
    path: string,
    surface: "main" | "subagent",
    meta: SubagentMeta | null
): Promise<number> {
    const delta = await readDelta(db, path);
    if (!delta) return 0;

    const insert = db.prepare(
        `INSERT OR REPLACE INTO llm
         (uuid, session, agent_id, ts, day, hour, model, effort, surface, agent_type, role, tool_use_id,
          in_tok, out_tok, cache_read, cache_write, cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            if (e.type !== "assistant") continue;
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

            insert.run(
                e.uuid ?? `${path}:${n}`,
                e.sessionId ?? e.session_id ?? "",
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

async function ingestTranscripts(db: Database): Promise<number> {
    const root = join(PROJECTS_ROOT, PROJECT_SLUG);
    if (!existsSync(root)) return 0;

    let n = 0;
    for (const entry of readdirSync(root)) {
        const full = join(root, entry);

        if (entry.endsWith(".jsonl")) {
            n += await ingestTranscript(db, full, "main", null);
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
            n += await ingestTranscript(db, join(subs, f), "subagent", meta);
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
function rebuildAgentRuns(db: Database): number {
    db.run("DELETE FROM agent_runs");
    db.run(`
        INSERT INTO agent_runs
        SELECT
            l.agent_id,
            max(l.session),
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

const db = openDb(DB_PATH);
const t0 = Date.now();
const spans = await ingestSpans(db);
const msgs = await ingestTranscripts(db);
const runs = rebuildAgentRuns(db);
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
    `ingested +${spans} spans, +${msgs} messages in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
        `(total ${totals.spans} spans, ${totals.llm} messages, ${runs} agent runs) → ${DB_PATH}`
);
db.close();
