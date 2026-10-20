/**
 * Doc comments describe the mechanism, never an issue log (issue #6170).
 *
 * A comment block that names three or more distinct `issue #N` refs is a
 * changelog: each slice of a lineage appends its own sentence to the same
 * docstring, so siblings in flight conflict by construction. History is git's
 * and the PRs'; a single `(issue #N)` pointer to a decision stays allowed.
 *
 * A RATCHET, not a sweep: the blocks that already exist are keyed in
 * `data/issue-log-comments-baseline.json` and may only shrink. A block is
 * keyed by file + a hash of its normalised text, so an EDITED legacy block is
 * a new block and reds — rewrite it to state the mechanism instead.
 *
 * Pure; `scripts/check-issue-log-comments.ts` feeds it the tracked sources.
 */
import { createHash } from "node:crypto";

/** Distinct refs at which a block counts as a log. */
export const ISSUE_LOG_THRESHOLD = 3;

export const ISSUE_LOG_BASELINE_PATH = "data/issue-log-comments-baseline.json";

/** Source files the guard reads: code, not generated output. */
export const ISSUE_LOG_SOURCE = /^(convex|src|scripts)\/.*\.tsx?$/;
export const ISSUE_LOG_EXCLUDED = /(^|\/)_generated\//;

export interface CommentBlock {
    /** 1-based line the block starts on. */
    line: number;
    text: string;
}

/** Every `//` run and every block comment of a source, as one block each. */
export function commentBlocks(source: string): CommentBlock[] {
    const lines = source.split("\n");
    const blocks: CommentBlock[] = [];
    let run: CommentBlock | null = null;
    let inBlock: CommentBlock | null = null;
    const flush = () => {
        if (run) blocks.push(run);
        run = null;
    };
    lines.forEach((raw, i) => {
        const t = raw.trim();
        if (inBlock) {
            inBlock.text += `\n${t}`;
            if (t.includes("*/")) {
                blocks.push(inBlock);
                inBlock = null;
            }
            return;
        }
        if (t.startsWith("//")) {
            if (run) run.text += `\n${t}`;
            else run = { line: i + 1, text: t };
            return;
        }
        flush();
        if (t.startsWith("/*")) {
            const block = { line: i + 1, text: t };
            if (t.includes("*/", 2)) blocks.push(block);
            else inBlock = block;
        }
    });
    flush();
    return blocks;
}

/** The distinct issue numbers a block names as `issue #N`. */
export function issueRefs(text: string): Set<number> {
    const refs = new Set<number>();
    for (const m of text.matchAll(/\bissue #(\d+)/gi)) refs.add(Number(m[1]));
    return refs;
}

/** Baseline key: file + hash of the block's whitespace-normalised text. */
export function blockKey(file: string, text: string): string {
    const norm = text.replace(/\s+/g, " ").trim();
    return `${file}#${createHash("sha1").update(norm).digest("hex").slice(0, 10)}`;
}

export interface IssueLogBlock {
    key: string;
    file: string;
    line: number;
    refs: number[];
}

/** The 3+-ref blocks of one file. */
export function issueLogBlocks(file: string, source: string): IssueLogBlock[] {
    const found: IssueLogBlock[] = [];
    for (const b of commentBlocks(source)) {
        const refs = issueRefs(b.text);
        if (refs.size >= ISSUE_LOG_THRESHOLD)
            found.push({
                key: blockKey(file, b.text),
                file,
                line: b.line,
                refs: [...refs].sort((a, c) => a - c),
            });
    }
    return found;
}

export interface IssueLogVerdict {
    ok: boolean;
    /** Blocks over the threshold that the baseline does not hold. */
    fresh: IssueLogBlock[];
    /** Baseline keys no block matches any more: delete them (shrink). */
    stale: string[];
}

export function issueLogVerdict(
    found: readonly IssueLogBlock[],
    baseline: readonly string[]
): IssueLogVerdict {
    const held = new Set(baseline);
    const present = new Set(found.map((b) => b.key));
    const fresh = found.filter((b) => !held.has(b.key));
    const stale = baseline.filter((k) => !present.has(k));
    return { ok: fresh.length === 0 && stale.length === 0, fresh, stale };
}

/** Keys `after` holds that `before` did not, sorted — the diff half. */
export function baselineAdditions(
    before: readonly string[],
    after: readonly string[]
): string[] {
    const was = new Set(before);
    return after.filter((k) => !was.has(k)).sort();
}
