// Pure token-usage accounting over Claude Code's own JSONL session
// transcripts (`~/.claude/projects/<slug>/<session-id>.jsonl`).
//
// This module has NO I/O — `scripts/usage-window.ts` does the file walking
// and streaming; everything here is a pure function over lines/records, which
// is what makes it fast to test (see `scripts/__tests__/usage-window.test.ts`).
//
// ─────────────────────────────────────────────────────────────────────────
// THE DOUBLE-COUNT TRAP
//
// Every assistant message line in a transcript carries `.message.usage` with
// TOP-LEVEL token fields (`input_tokens`, `output_tokens`,
// `cache_creation_input_tokens`, `cache_read_input_tokens`) AND an
// `iterations: [...]` array whose entries repeat those SAME numbers under the
// same field names. `iterations` is a breakdown of the top-level total, not an
// addition to it — summing both double-counts every line. This module reads
// ONLY the top-level fields and never inspects `.message.usage.iterations`.
// ─────────────────────────────────────────────────────────────────────────

export interface UsageRecord {
    tsMs: number;
    model: string;
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
}

export interface Categories {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
}

const zeroCategories = (): Categories => ({
    input: 0,
    output: 0,
    cacheCreation: 0,
    cacheRead: 0,
});

const addInto = (target: Categories, r: UsageRecord): void => {
    target.input += r.input;
    target.output += r.output;
    target.cacheCreation += r.cacheCreation;
    target.cacheRead += r.cacheRead;
};

const asFiniteNumber = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

/**
 * Parse one JSONL transcript line into a `UsageRecord`.
 *
 * Returns `null` for anything that is not an assistant message carrying
 * usage — user turns, tool_result lines, summaries — and for any line that
 * fails to parse or is missing a field this function needs. NEVER throws: a
 * 2GB corpus written by many CLI versions over time will contain shapes this
 * function did not anticipate, and one bad line must not take down a budget
 * check that gates an unattended run.
 */
export function parseUsageLine(line: string): UsageRecord | null {
    if (!line) return null;
    const trimmed = line.trim();
    if (!trimmed) return null;

    let obj: unknown;
    try {
        obj = JSON.parse(trimmed);
    } catch {
        return null;
    }
    if (typeof obj !== "object" || obj === null) return null;
    const rec = obj as Record<string, unknown>;

    const message = rec.message;
    if (typeof message !== "object" || message === null) return null;
    const msg = message as Record<string, unknown>;

    const model = msg.model;
    if (typeof model !== "string" || model.length === 0) return null;

    const usage = msg.usage;
    if (typeof usage !== "object" || usage === null) return null;
    const u = usage as Record<string, unknown>;

    const timestamp = rec.timestamp;
    if (typeof timestamp !== "string") return null;
    const tsMs = Date.parse(timestamp);
    if (!Number.isFinite(tsMs)) return null;

    // Deliberately top-level fields only — see the module comment. Do NOT
    // read `u.iterations` here.
    return {
        tsMs,
        model,
        input: asFiniteNumber(u.input_tokens),
        output: asFiniteNumber(u.output_tokens),
        cacheCreation: asFiniteNumber(u.cache_creation_input_tokens),
        cacheRead: asFiniteNumber(u.cache_read_input_tokens),
    };
}

/**
 * Sum records into per-model and total categories, restricted to the window
 * `[sinceMs, +inf)`.
 *
 * Boundary: a record with `tsMs === sinceMs` is INSIDE the window (the window
 * is closed on its left edge) — `sumWindow(records, sinceMs)` with
 * `--hours H` means "everything from exactly H hours ago until now".
 */
export function sumWindow(
    records: readonly UsageRecord[],
    sinceMs: number
): { models: Record<string, Categories>; totals: Categories } {
    const models: Record<string, Categories> = {};
    const totals = zeroCategories();
    for (const r of records) {
        if (r.tsMs < sinceMs) continue;
        let bucket = models[r.model];
        if (!bucket) {
            bucket = zeroCategories();
            models[r.model] = bucket;
        }
        addInto(bucket, r);
        addInto(totals, r);
    }
    return { models, totals };
}

// ─────────────────────────────────────────────────────────────────────────
// WEIGHTS — A LOCAL PROXY, NOT ANTHROPIC'S ACCOUNTING.
//
// There is no supported way for this script to read the real Anthropic quota:
// no `claude usage` subcommand exists, nothing under `~/.claude/config.json`,
// `daemon.status.json`, or `stats-cache.json` carries it, the transcripts
// don't either, and `/usage` is interactive-only. `pctOfBudget` below is
// therefore a LOCAL PROXY computed by weighting this machine's own transcript
// token counts against a budget the USER declares (`--budget` /
// `TOLARIA_LOOP_TOKEN_BUDGET`) — never mistake the resulting percentage for a
// quota reading. If a supported usage endpoint ever appears, that is what
// should replace this table, not a better-tuned version of it.
//
// The weights approximate relative LIST PRICE per token category, anchored so
// "1 unit == 1 sonnet input token" (an arbitrary but stated anchor — only the
// RATIOS matter for comparing burn across passes):
//   - opus output costs far more than sonnet output (~5x list price)
//   - a cache write costs slightly more than an equivalent fresh input token
//   - a cache read is an order of magnitude cheaper than a fresh input token
// These are illustrative ratios, not pinned to a price list that will drift;
// override them with `--weights <file.json>` if the real ratios matter to you.
// ─────────────────────────────────────────────────────────────────────────

export type WeightClass = "opus" | "sonnet" | "haiku";

export interface CategoryWeights {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
}

/** An unrecognised/new model MUST fall back to this class — fail expensive,
 * so an unknown model can never look artificially cheap and keep an
 * unattended loop running past its real budget. */
export const MOST_EXPENSIVE_WEIGHT_CLASS: WeightClass = "opus";

// sonnet and opus are exact against current list price ÷3 (the anchor is "1
// unit == 1 sonnet input token", see the module comment above). haiku is
// re-anchored to the same list, current tier (was pinned to Haiku 3.5
// pricing — $0.80/$4/$1.00/$0.08 — a stale generation of the family).
export const DEFAULT_WEIGHTS: Record<WeightClass, CategoryWeights> = {
    sonnet: { input: 1, output: 5, cacheCreation: 1.25, cacheRead: 0.1 },
    opus: { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.5 },
    haiku: {
        input: 0.33,
        output: 1.67,
        cacheCreation: 0.42,
        cacheRead: 0.033,
    },
};

/** Map a raw model string (e.g. `claude-opus-4-5-20260101`) to a weight
 * class. Falls back to `MOST_EXPENSIVE_WEIGHT_CLASS` for anything that
 * doesn't contain a recognised family name — see the fail-expensive note. */
export function classifyModel(model: string): WeightClass {
    const m = model.toLowerCase();
    if (m.includes("opus")) return "opus";
    if (m.includes("haiku")) return "haiku";
    if (m.includes("sonnet")) return "sonnet";
    return MOST_EXPENSIVE_WEIGHT_CLASS;
}

export function weightedTokens(
    sum: { models: Record<string, Categories> },
    weights: Record<WeightClass, CategoryWeights> = DEFAULT_WEIGHTS
): number {
    let total = 0;
    for (const [model, cats] of Object.entries(sum.models)) {
        const w = weights[classifyModel(model)];
        total +=
            cats.input * w.input +
            cats.output * w.output +
            cats.cacheCreation * w.cacheCreation +
            cats.cacheRead * w.cacheRead;
    }
    return total;
}

/** `budget <= 0` means "no budget configured" — return 0 rather than divide
 * by zero or produce `Infinity`, which would compare as ">= maxPct" and trip
 * an unattended loop's budget guard on a value that was never set. */
export function pctOfBudget(weighted: number, budget: number): number {
    if (!(budget > 0)) return 0;
    return (weighted / budget) * 100;
}
