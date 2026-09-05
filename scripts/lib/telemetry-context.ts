/**
 * Context-growth analysis over the telemetry mirror (issue #3078).
 *
 * ADR 0110 moved the work from an orchestrator fanning out to subagents into
 * ONE long main-thread context. That trade is a net win per issue, but nothing
 * in the new pipeline caps what accumulates, and a prompt that is re-read as
 * cache-read by every later turn makes the cost of a session super-linear in
 * its length. The two views here are what makes that visible:
 *
 *   1. the per-decile curve — mean cost and mean context per turn, by position
 *      within its session. A flat curve means hygiene is holding; a rising one
 *      prices the tail.
 *   2. the per-bucket attribution — how many tokens each kind of Bash call
 *      adds to the context it runs in.
 *
 * Both are PURE over plain rows so they run under the `node` vitest project:
 * `bun:sqlite` is a Bun builtin and is not available there (see
 * `telemetry-db.ts` for the same split). The CLI in `scripts/telemetry-context.ts`
 * owns every database call.
 *
 * ## The context estimator, and what it is not
 *
 * There is no record anywhere of how big a tool result was — the hook stores a
 * span's command, never its stdout. What IS recorded is each assistant
 * message's prompt size, and the prompt of message i+1 contains everything the
 * prompt of message i did, plus message i's own output, plus whatever came back
 * from the tools it called. So:
 *
 *     added(i) = ctx(i+1) - ctx(i) - out_tok(i)
 *
 * is what entered the context between two turns, and the spans whose pre-event
 * falls in [ts(i), ts(i+1)) are the calls that put it there. With several calls
 * in one interval the split is even — nothing in the data says which of three
 * parallel greps was the fat one — so `tokPerCall` is reported over SOLO
 * intervals only (exactly one span), where no split is needed and the number is
 * a real measurement rather than an average of an average.
 *
 * Two things this deliberately does not do:
 *
 * - it does not attribute Read/Edit/Grep/Write. The hook records spans for
 *   Bash, Agent, Skill and Task only, so an interval with no span at all is
 *   reported as `(untracked)` and holds those tools plus the user's own text.
 *   Over the 2026-08-28 baseline that is ~55% of all growth — a real hole, and
 *   naming it is better than silently folding it into `other`.
 * - it does not clamp a negative delta to zero. Context shrinks when the
 *   harness compacts a session; counting that as "nothing was added" would
 *   quietly credit the following calls with a discount they did not earn, so
 *   the interval is dropped and counted in `droppedIntervals`.
 *
 * ## One response, several rows
 *
 * The transcript writes ONE record per content block, and every record of a
 * multi-block response carries that response's full usage payload — a reply
 * that thinks, says something and calls a tool lands as three rows in `llm`
 * with identical counters (verified on `msg_011CedGxmy1t9eEU`, one `text` row
 * and one `tool_use` row). Over the 2026-08-28 baseline that is 38% of
 * main-thread rows.
 *
 * For the growth attribution this is not a rounding difference: the second row
 * of a pair has the SAME ctx as the first, so `added` comes out at `-out_tok`
 * and 40% of all intervals get discarded as compactions. `attributeGrowth`
 * therefore collapses them itself — a caller cannot get this wrong by
 * forgetting to.
 *
 * `summariseDeciles` deliberately does NOT: it reports the table as recorded,
 * which is what every other view over this store does and what the committed
 * baseline was taken from. The per-turn cost that results is inflated by the
 * same duplication — see `docs/findings/3078-llm-rows-double-count-a-response.md`
 * — so `formatReport` prints the response-level figures beside it rather than
 * quietly picking one.
 */

/** One assistant message on the main thread. */
export interface Turn {
    session: string;
    ts: number;
    cost: number;
    outTok: number;
    /** The full prompt of the request: input + cache read + cache write. */
    ctx: number;
}

/** One recorded tool call. `cmdBucket` is set for Bash spans only. */
export interface Span {
    session: string;
    ts: number;
    tool: string | null;
    cmdBucket: string | null;
}

export interface DecileRow {
    /** 0 = first tenth of a session, 9 = last. */
    decile: number;
    turns: number;
    meanCost: number;
    meanCtx: number;
}

export interface BucketRow {
    bucket: string;
    /** Every call seen in an attributable interval, solo or shared. */
    calls: number;
    /** Tokens attributed to this bucket, even split within shared intervals. */
    tokAdded: number;
    /** Calls that were the only span in their interval. */
    soloCalls: number;
    /** Mean tokens added over solo calls only; null when there were none. */
    tokPerCall: number | null;
    /** 90th percentile over solo calls; null when there were none. */
    p90: number | null;
}

export interface GrowthReport {
    buckets: BucketRow[];
    /** Growth in intervals that contained no recorded span at all. */
    untrackedTok: number;
    untrackedIntervals: number;
    /** Intervals whose delta was negative — a compaction, not an addition. */
    droppedIntervals: number;
}

/**
 * Which tenth of an `n`-turn session turn `i` (0-based) falls in.
 *
 * Integer division, so the last decile absorbs the remainder rather than a
 * lone 11th bucket appearing for `i === n - 1` (the classic `i / (n / 10)`
 * off-by-one).
 */
export function decileIndex(i: number, n: number): number {
    if (n <= 0) return 0;
    return Math.min(9, Math.floor((i * 10) / n));
}

/**
 * Session order. Timestamps are whole seconds, so several turns routinely
 * share one; context only ever grows within a session, which makes it the
 * tie-break that actually reflects the order the turns happened in.
 */
function bySessionOrder(a: Turn, b: Turn): number {
    return a.ts - b.ts || a.ctx - b.ctx;
}

/** Group turns by session, each group sorted into its real order. */
export function groupSessions(turns: Turn[]): Map<string, Turn[]> {
    const bySession = new Map<string, Turn[]>();
    for (const t of turns) {
        const list = bySession.get(t.session);
        if (list) list.push(t);
        else bySession.set(t.session, [t]);
    }
    for (const list of bySession.values()) list.sort(bySessionOrder);
    return bySession;
}

/**
 * Collapse the rows of one API response into a single turn.
 *
 * Adjacent rows of the same response share their whole usage payload, so an
 * identical `(ctx, outTok)` pair identifies them. It cannot merge two genuine
 * responses by accident: the second one's prompt necessarily contains the
 * first one's output, so its `ctx` is strictly larger.
 */
export function dedupeTurns(sorted: Turn[]): Turn[] {
    const out: Turn[] = [];
    for (const t of sorted) {
        const prev = out[out.length - 1];
        if (prev && prev.ctx === t.ctx && prev.outTok === t.outTok) continue;
        out.push(t);
    }
    return out;
}

/**
 * Mean cost and mean context per session decile.
 *
 * Sessions shorter than `minTurns` are excluded whole: with 6 turns, four
 * deciles are empty and the two that are not are noise, which drags the curve
 * the report exists to read.
 */
export function summariseDeciles(
    turns: Turn[],
    minTurns = 10,
    dedupe = false
): DecileRow[] {
    const cost = new Array<number>(10).fill(0);
    const ctx = new Array<number>(10).fill(0);
    const count = new Array<number>(10).fill(0);

    for (const raw of groupSessions(turns).values()) {
        const list = dedupe ? dedupeTurns(raw) : raw;
        if (list.length < minTurns) continue;
        for (let i = 0; i < list.length; i++) {
            const d = decileIndex(i, list.length);
            cost[d] += list[i].cost;
            ctx[d] += list[i].ctx;
            count[d] += 1;
        }
    }

    return count.map((turns, decile) => ({
        decile,
        turns,
        meanCost: turns ? cost[decile] / turns : 0,
        meanCtx: turns ? ctx[decile] / turns : 0,
    }));
}

/**
 * The bucket a span reports under: the Bash command class where there is one,
 * the lower-cased tool name otherwise (`agent`, `skill`, `task`).
 */
export function bucketOfSpan(span: Span): string {
    if (span.tool === "Bash") return span.cmdBucket ?? "other";
    return (span.tool ?? "unknown").toLowerCase();
}

/** Nearest-rank p90 — no interpolation, so the value is always an observation. */
function p90Of(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil(0.9 * sorted.length);
    return sorted[Math.max(0, rank - 1)];
}

/**
 * Attribute context growth to the tool calls that caused it.
 *
 * Spans are indexed by session and swept in timestamp order alongside that
 * session's turns, so the cost is one sort per session rather than a scan of
 * every span per interval.
 */
export function attributeGrowth(turns: Turn[], spans: Span[]): GrowthReport {
    const spansBySession = new Map<string, Span[]>();
    for (const s of spans) {
        const list = spansBySession.get(s.session);
        if (list) list.push(s);
        else spansBySession.set(s.session, [s]);
    }
    for (const list of spansBySession.values())
        list.sort((a, b) => a.ts - b.ts);

    const tokAdded = new Map<string, number>();
    const calls = new Map<string, number>();
    const soloSamples = new Map<string, number[]>();
    let untrackedTok = 0;
    let untrackedIntervals = 0;
    let droppedIntervals = 0;

    for (const [session, raw] of groupSessions(turns)) {
        const list = dedupeTurns(raw);
        const sessionSpans = spansBySession.get(session) ?? [];
        let cursor = 0;

        for (let i = 0; i + 1 < list.length; i++) {
            const t0 = list[i].ts;
            const t1 = list[i + 1].ts;
            const added = list[i + 1].ctx - list[i].ctx - list[i].outTok;

            // Advance the cursor even for intervals we skip, or the sweep
            // desynchronises from the turn timeline.
            while (cursor < sessionSpans.length && sessionSpans[cursor].ts < t0)
                cursor++;
            let end = cursor;
            while (end < sessionSpans.length && sessionSpans[end].ts < t1)
                end++;

            if (added < 0) {
                droppedIntervals++;
                continue;
            }
            const k = end - cursor;
            if (k === 0) {
                untrackedTok += added;
                untrackedIntervals++;
                continue;
            }

            const share = added / k;
            for (let j = cursor; j < end; j++) {
                const bucket = bucketOfSpan(sessionSpans[j]);
                tokAdded.set(bucket, (tokAdded.get(bucket) ?? 0) + share);
                calls.set(bucket, (calls.get(bucket) ?? 0) + 1);
                if (k === 1) {
                    const samples = soloSamples.get(bucket);
                    if (samples) samples.push(added);
                    else soloSamples.set(bucket, [added]);
                }
            }
        }
    }

    const buckets: BucketRow[] = [...calls.keys()]
        .map((bucket) => {
            const samples = soloSamples.get(bucket) ?? [];
            const soloTotal = samples.reduce((a, b) => a + b, 0);
            return {
                bucket,
                calls: calls.get(bucket) ?? 0,
                tokAdded: Math.round(tokAdded.get(bucket) ?? 0),
                soloCalls: samples.length,
                tokPerCall: samples.length
                    ? Math.round(soloTotal / samples.length)
                    : null,
                p90: p90Of(samples),
            };
        })
        .sort((a, b) => b.tokAdded - a.tokAdded);

    return {
        buckets,
        untrackedTok: Math.round(untrackedTok),
        untrackedIntervals,
        droppedIntervals,
    };
}

/** Share of total turn cost spent in the back half of a session (deciles 5-9). */
export function backHalfShare(rows: DecileRow[]): number {
    const total = rows.reduce((n, r) => n + r.meanCost * r.turns, 0);
    if (total === 0) return 0;
    const back = rows.slice(5).reduce((n, r) => n + r.meanCost * r.turns, 0);
    return back / total;
}

function pad(s: string, w: number, right = true): string {
    return right ? s.padStart(w) : s.padEnd(w);
}

/** Render both views as one plain-text receipt, safe to paste into a PR. */
export function formatReport(
    from: string,
    to: string,
    sessions: number,
    rows: DecileRow[],
    growth: GrowthReport,
    /** The same curve with each API response counted once. */
    perResponse?: DecileRow[]
): string {
    const out: string[] = [];
    out.push(`context hygiene — ${from} → ${to} (${sessions} sessions)`);
    out.push("");
    out.push("  decile   turns   mean $/turn   mean ctx");
    for (const r of rows) {
        out.push(
            `  ${pad(String(r.decile), 6, false)} ${pad(String(r.turns), 7)}   ${pad(
                `$${r.meanCost.toFixed(4)}`,
                11
            )}   ${pad(`${Math.round(r.meanCtx / 1000)}k`, 8)}`
        );
    }
    const first = rows[0];
    const last = rows[9];
    if (first?.turns && last?.turns) {
        const ratio = first.meanCost ? last.meanCost / first.meanCost : 0;
        out.push("");
        out.push(
            `  last/first turn cost: ${ratio.toFixed(2)}x — back half = ` +
                `${(backHalfShare(rows) * 100).toFixed(0)}% of main-thread spend`
        );
    }
    // The table above counts transcript ROWS, which is how the baseline was
    // taken and how every other view over this store reads. One API response
    // writes one row per content block, so that overstates both the turn count
    // and the per-turn cost; this line is the same window with a response
    // counted once.
    const pFirst = perResponse?.[0];
    const pLast = perResponse?.[9];
    if (pFirst?.turns && pLast?.turns) {
        out.push(
            `  per API response (one response = one turn): ` +
                `$${pFirst.meanCost.toFixed(4)} → $${pLast.meanCost.toFixed(4)} ` +
                `over ${perResponse!.reduce((n, r) => n + r.turns, 0)} turns`
        );
    }

    out.push("");
    out.push("  bucket        calls   tok added   solo    tok/call     p90");
    for (const b of growth.buckets) {
        out.push(
            `  ${pad(b.bucket, 12, false)} ${pad(String(b.calls), 6)}   ${pad(
                String(b.tokAdded),
                9
            )}   ${pad(String(b.soloCalls), 5)}   ${pad(
                b.tokPerCall === null ? "-" : String(b.tokPerCall),
                8
            )}   ${pad(b.p90 === null ? "-" : String(b.p90), 6)}`
        );
    }
    out.push("");
    out.push(
        `  untracked (Read/Edit/Grep/user text): ${growth.untrackedTok} tok ` +
            `over ${growth.untrackedIntervals} intervals; ` +
            `${growth.droppedIntervals} intervals dropped (context compacted)`
    );
    return out.join("\n");
}
