/**
 * Read-only reader for opencode's local session store (`opencode.db`), so the
 * telemetry ingest can mirror opencode's token usage and session facts into the
 * same SQLite mirror that already carries Claude Code's.
 *
 * WHY A SEPARATE MODULE. The shape of opencode.db is an internal detail of the
 * opencode harness — it is not documented, and it changes between versions. It
 * is isolated here so that a schema change in a future opencode release breaks
 * one file, not the ingest pipeline. Every access is defensive: a missing
 * column or an unexpected JSON shape degrades to null/0 rather than throwing.
 *
 * The two facts this module leans on (both observed on the real store):
 *
 *   session.parent_id  — null on the main thread, set to the parent's id on a
 *                        subagent's own session. This is the main/subagent
 *                        split, mirroring Claude's transcript folders.
 *   session.title      — auto-generated as "<role> <issue|PR> (@<agent>
 *                        subagent)", e.g. "Review PR #1048 (@general subagent)".
 *                        The role prefix feeds `classifyRole`, the #N feeds
 *                        issue attribution — same two signals Claude carries in
 *                        the spawn description and its meta.json.
 *
 * Token mapping (opencode -> the llm table). opencode's usage is
 * `{ total, input, output, reasoning, cache: { write, read } }`. `reasoning`
 * is billed at the OUTPUT rate by DeepSeek, so it is folded into `out_tok`;
 * `cache.read`/`cache.write` map straight across.
 */

import type { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";

export const OPENCODE_DB_PATH = join(
    homedir(),
    ".local/share/opencode/opencode.db"
);

export interface OpencodeSession {
    id: string;
    parentId: string | null;
    agent: string | null;
    modelId: string | null;
    title: string;
    tokensInput: number;
    tokensOutput: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    timeCreatedMs: number;
    timeUpdatedMs: number;
}

export interface OpencodeMessage {
    id: string;
    sessionId: string; // the subagent's own session id (== main id when main)
    mainSessionId: string; // parent id for subagents, own id for the main thread
    surface: "main" | "subagent";
    agentType: string | null;
    modelId: string | null;
    inTok: number;
    outTok: number;
    cacheRead: number;
    cacheWrite: number;
    tsMs: number;
}

/** Parse `session.model`, which is a JSON object, tolerating non-JSON values. */
function modelIdOf(model: string | null): string | null {
    if (!model) return null;
    try {
        const m = JSON.parse(model) as { id?: string };
        return m.id ?? null;
    } catch {
        return model;
    }
}

/** The project whose directory list contains `directory`. */
export function projectIdFor(oc: Database, directory: string): string | null {
    try {
        const row = oc
            .query<
                { project_id: string },
                [string]
            >("SELECT project_id FROM project_directory WHERE directory = ? LIMIT 1")
            .get(directory);
        return row?.project_id ?? null;
    } catch {
        return null;
    }
}

/** All sessions of a project, ordered by creation time. */
export function listSessions(
    oc: Database,
    projectId: string
): OpencodeSession[] {
    let rows: Array<Record<string, unknown>>;
    try {
        rows = oc
            .query(
                `SELECT id, parent_id, agent, model, title,
                        tokens_input, tokens_output, tokens_cache_read, tokens_cache_write,
                        time_created, time_updated
                 FROM session WHERE project_id = ? ORDER BY time_created`
            )
            .all(projectId) as Array<Record<string, unknown>>;
    } catch {
        return [];
    }
    return rows.map((r) => ({
        id: String(r.id ?? ""),
        parentId: (r.parent_id as string | null) ?? null,
        agent: (r.agent as string | null) ?? null,
        modelId: modelIdOf((r.model as string | null) ?? null),
        title: String(r.title ?? ""),
        tokensInput: Number(r.tokens_input ?? 0),
        tokensOutput: Number(r.tokens_output ?? 0),
        tokensCacheRead: Number(r.tokens_cache_read ?? 0),
        tokensCacheWrite: Number(r.tokens_cache_write ?? 0),
        timeCreatedMs: Number(r.time_created ?? 0),
        timeUpdatedMs: Number(r.time_updated ?? 0),
    }));
}

export interface OpencodeMessageTokens {
    modelId: string | null;
    inTok: number;
    outTok: number; // output + reasoning (both billed at the output rate)
    cacheRead: number;
    cacheWrite: number;
    tsMs: number;
}

/**
 * Parse one `message.data` JSON blob into the token usage the llm table needs.
 * Pure and sqlite-free so the token-mapping rules are testable under Node.
 * Returns null for non-assistant or malformed lines.
 */
export function parseOpencodeMessageData(
    data: string,
    fallbackModelId: string | null
): OpencodeMessageTokens | null {
    let d: Record<string, unknown>;
    try {
        d = JSON.parse(data);
    } catch {
        return null;
    }
    if (d.role !== "assistant") return null;
    const tokens = (d.tokens ?? {}) as {
        input?: number;
        output?: number;
        reasoning?: number;
        cache?: { read?: number; write?: number };
    };
    const time = (d.time ?? {}) as { created?: number; completed?: number };
    return {
        modelId: (d.modelID as string | null) ?? fallbackModelId,
        inTok: Number(tokens.input ?? 0),
        outTok: Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0),
        cacheRead: Number(tokens.cache?.read ?? 0),
        cacheWrite: Number(tokens.cache?.write ?? 0),
        tsMs: Number(time.created ?? 0) || Number(time.completed ?? 0),
    };
}

/**
 * Assistant messages for one session, after the watermark. Each message's
 * `data` JSON carries the token usage and the model id. `ctx` carries the
 * per-session facts the message JSON does not (which parent it belongs to, and
 * the session-level model as a fallback when a message omits `modelID`).
 */
export function listMessages(
    oc: Database,
    sessionId: string,
    afterMs: number,
    ctx: {
        mainSessionId: string;
        surface: "main" | "subagent";
        agentType: string | null;
        fallbackModelId: string | null;
    }
): OpencodeMessage[] {
    let rows: Array<{ id: string; data: string }>;
    try {
        rows = oc
            .query<{ id: string; data: string }, [string, number]>(
                `SELECT id, data FROM message
                 WHERE session_id = ? AND time_created > ?
                 ORDER BY time_created`
            )
            .all(sessionId, afterMs);
    } catch {
        return [];
    }
    const out: OpencodeMessage[] = [];
    for (const { id, data } of rows) {
        const t = parseOpencodeMessageData(data, ctx.fallbackModelId);
        if (!t) continue;
        out.push({
            id,
            sessionId,
            mainSessionId: ctx.mainSessionId,
            surface: ctx.surface,
            agentType: ctx.agentType,
            modelId: t.modelId,
            inTok: t.inTok,
            outTok: t.outTok,
            cacheRead: t.cacheRead,
            cacheWrite: t.cacheWrite,
            tsMs: t.tsMs,
        });
    }
    return out;
}
