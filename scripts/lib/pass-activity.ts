/**
 * What ONE loop-drain pass is doing right now (issue #4722) — the level-B
 * half of the AFK terminal's status line, read from the pass's own
 * transcript.
 *
 * EXACT BINDING. The driver runs every pass as `claude -p --session-id
 * <uuid>` and names that uuid in the pass-start tag, so the transcript is
 * `<projectsRoot>/<slug>/<uuid>.jsonl` and its subagents are
 * `<uuid>/subagents/*.jsonl` — by construction, never by the issue-mention
 * heuristic `live-activity.ts` needs for sessions nobody bound.
 *
 * THREE READS:
 *
 *   * LAST TOOL — the most recent `tool_use` block in the MAIN transcript,
 *     named and targeted the way the dashboard's tail names it
 *     (`describeToolInput`, shared).
 *   * ACTIVE SUBAGENTS — subagent transcripts whose last turn has not ended.
 *     A subagent's final assistant line carries `stop_reason: "end_turn"`; a
 *     later user line (a `SendMessage` resuming it) opens a turn again. A
 *     transcript with no assistant line yet is active: it was just spawned.
 *   * PASS TOKENS — main + subagents, in the SAME weighted unit the driver's
 *     budget uses (`parseUsageLine` + `weightedTokens`, shared with
 *     `usage:window`), so the number sits beside the run's spend without a
 *     unit conversion in the reader's head.
 *
 * INCREMENTAL. Each file keeps a byte cursor (`readLinesFrom`, shared); a
 * refresh reads only what was appended, and a half-written last line is
 * re-read whole next time. A file that shrank is re-read from byte 0 and
 * the whole pass's totals rebuilt — the same caution `LiveIndex` takes.
 *
 * INJECTED ROOTS. `projectsRoot` / `projectSlug` are parameters: the tests
 * point them at a temp directory, and nothing here reads `homedir()`.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
    SESSION_ID_RE,
    describeToolInput,
    projectDirsOf,
    readLinesFrom,
} from "./live-activity";
import {
    parseUsageLine,
    weightedTokens,
    type Categories,
} from "./usage-window";

export interface PassActivity {
    /** The last tool the MAIN session called, or null before the first. */
    lastTool: { name: string; target: string } | null;
    activeSubagents: number;
    /** Weighted tokens (the budget's unit), main + subagents. */
    tokens: number;
}

export interface PassActivityOptions {
    projectsRoot: string;
    projectSlug: string;
    /** The pass's `--session-id`. Anything that is not a UUID never reaches
     *  the filesystem. */
    session: string;
}

/** Claude Code's project directory name for a cwd: every non-alphanumeric
 *  character becomes `-` (`/Users/x/tolaria` → `-Users-x-tolaria`). */
export function projectSlugOf(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

interface Cursor {
    offset: number;
}

interface ContentBlock {
    type?: string;
    name?: string;
    input?: unknown;
}

interface Line {
    type?: string;
    isMeta?: boolean;
    message?: { stop_reason?: string | null; content?: unknown };
}

const parse = (raw: string): Line | null => {
    try {
        const v: unknown = JSON.parse(raw);
        return v && typeof v === "object" ? (v as Line) : null;
    } catch {
        return null;
    }
};

export class PassActivityReader {
    private readonly opts: PassActivityOptions;
    /** The directory holding `<session>.jsonl`, once found. */
    private dir: string | null = null;
    private cursors = new Map<string, Cursor>();
    private models: Record<string, Categories> = {};
    private lastTool: PassActivity["lastTool"] = null;
    /** Subagent transcript path → whether its last turn has ended. */
    private subDone = new Map<string, boolean>();

    constructor(opts: PassActivityOptions) {
        this.opts = opts;
    }

    /** The main transcript's path, or null when it is not on disk (yet). */
    transcriptPath(): string | null {
        if (!SESSION_ID_RE.test(this.opts.session)) return null;
        if (this.dir) return join(this.dir, `${this.opts.session}.jsonl`);
        for (const dir of projectDirsOf(
            this.opts.projectsRoot,
            this.opts.projectSlug
        )) {
            if (existsSync(join(dir, `${this.opts.session}.jsonl`))) {
                this.dir = dir;
                return join(dir, `${this.opts.session}.jsonl`);
            }
        }
        return null;
    }

    /**
     * Read whatever was appended since the last call. `null` when the
     * transcript cannot be found — the status line then falls back to its
     * level-A fields.
     */
    refresh(): PassActivity | null {
        const main = this.transcriptPath();
        if (!main || !this.dir) return null;
        if (!this.readFile(main, "main")) {
            // Shrank under us: rebuild the whole pass from byte 0.
            this.reset();
            this.readFile(main, "main");
        }
        const subsDir = join(this.dir, this.opts.session, "subagents");
        let subs: string[] = [];
        try {
            subs = readdirSync(subsDir).filter((f) => f.endsWith(".jsonl"));
        } catch {
            // No subagent has been spawned yet.
        }
        for (const f of subs) {
            if (!this.readFile(join(subsDir, f), "subagent")) {
                this.reset();
                return this.refresh();
            }
        }
        let active = 0;
        for (const done of this.subDone.values()) if (!done) active++;
        return {
            lastTool: this.lastTool,
            activeSubagents: active,
            tokens: weightedTokens({ models: this.models }),
        };
    }

    private reset(): void {
        this.cursors.clear();
        this.models = {};
        this.lastTool = null;
        this.subDone.clear();
    }

    /** Fold the file's new bytes in. `false` when it shrank past its cursor. */
    private readFile(path: string, kind: "main" | "subagent"): boolean {
        let size: number;
        try {
            size = statSync(path).size;
        } catch {
            return true;
        }
        const cur = this.cursors.get(path) ?? { offset: 0 };
        if (cur.offset > size) return false;
        if (kind === "subagent" && !this.subDone.has(path))
            this.subDone.set(path, false);
        const { lines, nextOffset } = readLinesFrom(path, cur.offset, size);
        cur.offset = nextOffset;
        this.cursors.set(path, cur);
        for (const raw of lines) this.foldLine(raw, path, kind);
        return true;
    }

    private foldLine(raw: string, path: string, kind: "main" | "subagent") {
        const usage = parseUsageLine(raw);
        if (usage) {
            const c = (this.models[usage.model] ??= {
                input: 0,
                output: 0,
                cacheCreation: 0,
                cacheRead: 0,
            });
            c.input += usage.input;
            c.output += usage.output;
            c.cacheCreation += usage.cacheCreation;
            c.cacheRead += usage.cacheRead;
        }
        const e = parse(raw);
        if (!e || e.isMeta) return;
        if (kind === "subagent") {
            if (e.type === "assistant")
                this.subDone.set(path, e.message?.stop_reason === "end_turn");
            else if (e.type === "user") this.subDone.set(path, false);
            return;
        }
        if (e.type !== "assistant") return;
        const content = e.message?.content;
        if (!Array.isArray(content)) return;
        for (const block of content as ContentBlock[]) {
            if (block?.type !== "tool_use") continue;
            const name = block.name ?? "tool";
            this.lastTool = {
                name,
                target: describeToolInput(name, block.input),
            };
        }
    }
}
