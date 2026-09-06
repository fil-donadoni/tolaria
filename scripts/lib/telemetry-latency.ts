/**
 * Latency analysis over the telemetry mirror (issue #3079).
 *
 * ADR 0110 set a target — "a median issue closes in 10-15 minutes" — that
 * nothing has ever checked, because nothing reports how long an issue actually
 * takes. This module is that report. It splits a session's wall clock into the
 * three things it can be spent on:
 *
 *   tool   — a recorded tool call was running
 *   model  — the model was generating (no tool in flight, no human in the loop)
 *   idle   — neither: the session was sitting open waiting for a person
 *
 * Everything here is PURE over plain rows so it runs under the `node` vitest
 * project: `bun:sqlite` is a Bun builtin and is not available there (the same
 * split `telemetry-context.ts` uses). The CLI in `scripts/telemetry-latency.ts`
 * owns every database call.
 *
 * ## Why the split needs deriving at all
 *
 * The store records, per assistant message, WHEN it was written, and per tool
 * call, when it started and how long it ran. It records nothing about when a
 * generation began or when a human read the screen. So a session left open over
 * lunch and a session grinding the gate look identical in every existing view —
 * which is exactly what issue #3079 says has to stop.
 *
 * The derivation walks each session's turns in order and classifies the gap
 * before each one:
 *
 * - **A gap that follows a tool call is machine time.** Once a tool result is
 *   back, the loop is running: the model is generating the next message and no
 *   human can interject. The whole gap is `model`, capped at
 *   `MODEL_CEILING_S` — above that ceiling the session was almost certainly
 *   interrupted, so only `estimateGenerationSeconds` counts and the rest is
 *   idle. Over the 2026-08-28 baseline the ceiling touches under 1% of these
 *   gaps (p99 = 54s).
 *
 * - **A gap with no tool call in it is ambiguous**: the model yielded, a person
 *   read it and typed, and then the model generated a reply. Only the
 *   generation is machine time, so it is estimated and the remainder is idle.
 *
 * The estimator is a line fitted on the unambiguous gaps — the ones that follow
 * a tool call, where the elapsed time IS the generation. Over 13.4k such gaps
 * in the 2026-08-28 → 2026-09-05 window, least squares gives
 * `gap ≈ 2.05s + out_tok / 92`, with prompt size adding a statistically real
 * but practically irrelevant term (0.4s at a 100k context). {@link
 * GEN_FIXED_S} and {@link GEN_TOK_PER_S} are deliberately looser than that fit
 * (3s, 50 tok/s), because the error the report must not make is filing a real
 * generation as human idle.
 *
 * ## What it deliberately does not do
 *
 * - **Backgrounded work is not tool time.** A `run_in_background` Bash call and
 *   a backgrounded `Agent` spawn both return immediately, so their span
 *   measures the launch, not the run (the same caveat `agent_runs` carries in
 *   `telemetry-db.ts`). The work still happens — it just happens while the
 *   model is generating, which is where this report puts it. Over the baseline
 *   window that is 49 spans averaging 1.8s, so it moves nothing.
 * - **Read/Edit/Grep/Write have no spans at all.** The hook records Bash,
 *   Agent, Skill and Task only. Their latency is real and lands in `model`,
 *   since it sits between a tool result and the next message with no span to
 *   claim it. `tool` is therefore a floor on machine tool time, not a total.
 * - **It does not classify from the stored `cmd_bucket`.** Gate classification
 *   runs at query time through `classifyKind` in `telemetry-db.ts`, so widening
 *   what counts as a gate reclassifies the whole history instead of only the
 *   rows ingested afterwards. The DASHBOARD does read the stored `kind` and
 *   `cmd_bucket` columns, which are written once at insert time — so widening
 *   the classifier without touching them would have shown the same command in
 *   two different buckets either side of the change. `reclassifySpans` in
 *   `telemetry-ingest.ts` closes that on the next ingest; bump its
 *   `SPAN_CLASSIFIER_VERSION` alongside any future classifier change.
 */

import { classifyKind } from "./telemetry-db.ts";

/** One assistant message on the main thread. */
export interface LatencyTurn {
    session: string;
    ts: number;
    outTok: number;
    /** The full prompt of the request: input + cache read + cache write. */
    ctx: number;
}

/** One recorded tool call. */
export interface LatencySpan {
    session: string;
    ts: number;
    durS: number;
    tool: string | null;
    cmd: string | null;
}

/** What a session was, beyond its turns: the PRs it linked and its opening command. */
export interface SessionMeta {
    session: string;
    /** PR numbers from `pr-link` events; a session with none landed nothing. */
    prs: number[];
    /** The first slash-command prompt seen, e.g. `/next-issue 3079`. */
    cmd: string | null;
}

/** One session's wall clock, split. All figures in seconds. */
export interface SessionLatency {
    session: string;
    cmd: string | null;
    prs: number;
    turns: number;
    /** Last main-thread message minus the first. */
    wallS: number;
    /** Union of the recorded tool spans, clipped to the session. */
    toolS: number;
    /** The gate/test/build share of `toolS`. */
    gateS: number;
    /** Gaps attributed to generation. */
    modelS: number;
    /** `toolS + modelS` — the floor a session cannot go below, whatever the human does. */
    machineS: number;
    /** `wallS` minus the two above; never negative. */
    idleS: number;
}

export interface ComponentStat {
    /** Seconds. */
    median: number;
    p90: number;
    mean: number;
}

export interface Cohort {
    name: string;
    sessions: number;
    wall: ComponentStat;
    tool: ComponentStat;
    gate: ComponentStat;
    model: ComponentStat;
    machine: ComponentStat;
    idle: ComponentStat;
}

/**
 * Fixed overhead of a generation, in seconds — request dispatch plus the
 * timestamp being stamped in whole seconds. Fitted at 2.05s; rounded up,
 * because over-attributing to the model costs a few seconds and
 * under-attributing invents human idle that never happened.
 */
export const GEN_FIXED_S = 3;

/** Output tokens per second. Fitted at 92; used at 50, for the same reason. */
export const GEN_TOK_PER_S = 50;

/**
 * A post-tool gap longer than this was not one generation — the session was
 * interrupted, or the machine slept. Above it only the estimate counts as
 * model time. The 2026-08-28 baseline puts p99 of these gaps at 54s.
 */
export const MODEL_CEILING_S = 120;

/** How long the model plausibly spent producing a message of this size. */
export function estimateGenerationSeconds(outTok: number): number {
    return GEN_FIXED_S + Math.max(0, outTok) / GEN_TOK_PER_S;
}

/**
 * Session order. Timestamps are whole seconds, so several turns routinely share
 * one; context only ever grows within a session, which makes it the tie-break
 * that reflects the order the turns really happened in (the same ordering
 * `telemetry-context.ts` uses).
 */
function byTurnOrder(a: LatencyTurn, b: LatencyTurn): number {
    return a.ts - b.ts || a.ctx - b.ctx;
}

/**
 * Collapse the rows of one API response into a single turn.
 *
 * The transcript writes one record per content block and every record of a
 * multi-block response carries that response's full usage payload, so siblings
 * share their whole `(ts, ctx, outTok)` triple. Left in, they read as
 * zero-second turns and would each be credited a fresh generation.
 *
 * The timestamp is part of the key and not an afterthought. `(ctx, outTok)`
 * alone also matches two GENUINELY distinct turns whose prompt happened not to
 * grow, and collapsing one of those deletes a real turn boundary — which, when
 * the two are minutes apart, deletes the gap between them from the split
 * entirely. On the store as it stands the tighter key is the only correct one:
 * the ingest keys `llm` on `message.id` since issue #3078, so no true sibling
 * pair survives, and over the 2026-08-28 → 2026-09-05 window `(ctx, outTok)`
 * matched 13 pairs, every one of them at a DIFFERENT timestamp (up to 351s
 * apart) — i.e. every match was a false positive. On an older store that was
 * never re-ingested the tighter key collapses less, which costs a few seconds
 * of estimated generation; the looser one silently ate a six-minute gap.
 */
export function dedupeTurns(sorted: LatencyTurn[]): LatencyTurn[] {
    const out: LatencyTurn[] = [];
    for (const t of sorted) {
        const prev = out[out.length - 1];
        if (
            prev &&
            prev.ts === t.ts &&
            prev.ctx === t.ctx &&
            prev.outTok === t.outTok
        )
            continue;
        out.push(t);
    }
    return out;
}

/** Total length covered by a set of intervals, counting overlap once. */
export function unionSeconds(
    intervals: Array<{ start: number; end: number }>
): number {
    if (intervals.length === 0) return 0;
    const sorted = [...intervals]
        .filter((i) => i.end > i.start)
        .sort((a, b) => a.start - b.start);
    let total = 0;
    let openStart = -Infinity;
    let openEnd = -Infinity;
    for (const i of sorted) {
        if (i.start > openEnd) {
            if (openEnd > openStart) total += openEnd - openStart;
            openStart = i.start;
            openEnd = i.end;
        } else if (i.end > openEnd) {
            openEnd = i.end;
        }
    }
    if (openEnd > openStart) total += openEnd - openStart;
    return total;
}

/** True when a span is a gate, a test run or a build — the machine-time block ADR 0110 moved around. */
export function isGateSpan(span: LatencySpan): boolean {
    return classifyKind(span.tool, span.cmd).startsWith("gate:");
}

/**
 * Split one session's wall clock into tool / model / idle.
 *
 * `turns` and `spans` may arrive in any order and may contain rows from other
 * sessions; both are filtered and sorted here so a caller cannot get the
 * ordering subtly wrong.
 */
export function sessionLatency(
    session: string,
    turnsIn: LatencyTurn[],
    spansIn: LatencySpan[],
    meta?: SessionMeta
): SessionLatency | null {
    const turns = dedupeTurns(
        turnsIn.filter((t) => t.session === session).sort(byTurnOrder)
    );
    if (turns.length === 0) return null;

    const first = turns[0].ts;
    const last = turns[turns.length - 1].ts;
    const wallS = Math.max(0, last - first);

    // Spans are clipped to the session's own window: a hung command whose span
    // runs 14 hours past the last message would otherwise report more tool time
    // than the session had wall clock.
    const spans = spansIn
        .filter((s) => s.session === session)
        .sort((a, b) => a.ts - b.ts);
    const clip = (s: LatencySpan) => ({
        start: Math.max(first, Math.min(s.ts, last)),
        end: Math.max(first, Math.min(s.ts + Math.max(0, s.durS), last)),
    });
    const toolS = unionSeconds(spans.map(clip));
    const gateS = unionSeconds(spans.filter(isGateSpan).map(clip));

    let modelS = 0;
    let cursor = 0;
    // The furthest any span seen so far reaches. A span that STARTS before an
    // interval can still be running inside it — a backgrounded call, or one
    // whose turn was written before it returned — and the cursor, which only
    // ever moves forward, would otherwise make that interval look tool-free.
    // It would then take the estimator branch and file real machine time as
    // human idle, which is the one error this report exists to avoid.
    let reach = -Infinity;
    for (let i = 0; i + 1 < turns.length; i++) {
        const t0 = turns[i].ts;
        const t1 = turns[i + 1].ts;

        // Advance past spans that started before this interval, then find the
        // latest end among those that started inside it. The cursor is advanced
        // even for intervals that contribute nothing, or the sweep
        // desynchronises from the turn timeline.
        while (cursor < spans.length && spans[cursor].ts < t0) {
            reach = Math.max(
                reach,
                spans[cursor].ts + Math.max(0, spans[cursor].durS)
            );
            cursor++;
        }
        let end = cursor;
        let lastSpanEnd = reach > t0 ? reach : -Infinity;
        while (end < spans.length && spans[end].ts < t1) {
            lastSpanEnd = Math.max(
                lastSpanEnd,
                spans[end].ts + Math.max(0, spans[end].durS)
            );
            end++;
        }

        const afterTool = end > cursor || reach > t0;
        const from = afterTool ? Math.min(Math.max(t0, lastSpanEnd), t1) : t0;
        const remaining = Math.max(0, t1 - from);
        const estimate = estimateGenerationSeconds(turns[i + 1].outTok);
        modelS += afterTool
            ? remaining <= MODEL_CEILING_S
                ? remaining
                : Math.min(remaining, estimate)
            : Math.min(remaining, estimate);
    }

    // Tool and model are disjoint by construction — model is only ever measured
    // from the end of the last span in an interval — but a span clipped at the
    // session edge can still push the pair past the wall clock by a second or
    // two, and a negative idle would read as a bug rather than as rounding.
    const idleS = Math.max(0, wallS - toolS - modelS);

    return {
        session,
        cmd: meta?.cmd ?? null,
        prs: meta?.prs.length ?? 0,
        turns: turns.length,
        wallS,
        toolS,
        gateS,
        modelS,
        machineS: toolS + modelS,
        idleS,
    };
}

/** Every session present in `turns`, split. Sessions with one turn are dropped. */
export function allSessionLatencies(
    turns: LatencyTurn[],
    spans: LatencySpan[],
    meta: SessionMeta[]
): SessionLatency[] {
    const metaBySession = new Map(meta.map((m) => [m.session, m]));
    const turnsBySession = new Map<string, LatencyTurn[]>();
    for (const t of turns) {
        const list = turnsBySession.get(t.session);
        if (list) list.push(t);
        else turnsBySession.set(t.session, [t]);
    }
    const spansBySession = new Map<string, LatencySpan[]>();
    for (const s of spans) {
        const list = spansBySession.get(s.session);
        if (list) list.push(s);
        else spansBySession.set(s.session, [s]);
    }

    const out: SessionLatency[] = [];
    for (const [session, list] of turnsBySession) {
        const row = sessionLatency(
            session,
            list,
            spansBySession.get(session) ?? [],
            metaBySession.get(session)
        );
        if (row && row.turns > 1) out.push(row);
    }
    return out.sort((a, b) => b.wallS - a.wallS);
}

/** Nearest-rank quantile — no interpolation, so the value is always an observation. */
export function quantile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.ceil(p * sorted.length);
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

function stat(values: number[]): ComponentStat {
    if (values.length === 0) return { median: 0, p90: 0, mean: 0 };
    const sum = values.reduce((a, b) => a + b, 0);
    return {
        median: quantile(values, 0.5),
        p90: quantile(values, 0.9),
        mean: sum / values.length,
    };
}

/**
 * Median / p90 / mean of each component over a set of sessions.
 *
 * Every component is summarised independently, so the medians do NOT add up to
 * the median wall — the session at the middle of the wall distribution is not
 * the one at the middle of the idle distribution. That is a property of
 * reporting a distribution rather than a mean, which is what the issue asked
 * for; the mean column is there for the one reading where the parts do sum.
 */
export function summarise(name: string, rows: SessionLatency[]): Cohort {
    return {
        name,
        sessions: rows.length,
        wall: stat(rows.map((r) => r.wallS)),
        tool: stat(rows.map((r) => r.toolS)),
        gate: stat(rows.map((r) => r.gateS)),
        model: stat(rows.map((r) => r.modelS)),
        machine: stat(rows.map((r) => r.machineS)),
        idle: stat(rows.map((r) => r.idleS)),
    };
}

/** A session that landed at least one PR — the closest observable proxy for "closed an issue". */
export function isIssueClosing(row: SessionLatency): boolean {
    return row.prs > 0;
}

/** A session opened with `/next-issue` — the ADR 0110 pipeline the 10-15 minute target is about. */
export function isNextIssue(row: SessionLatency): boolean {
    return /^\/next-issue\b/.test(row.cmd ?? "");
}

function pad(s: string, w: number, right = true): string {
    return right ? s.padStart(w) : s.padEnd(w);
}

function mins(seconds: number): string {
    return `${(seconds / 60).toFixed(1)}m`;
}

function cohortRows(c: Cohort): string[] {
    const parts: Array<[string, ComponentStat]> = [
        ["wall", c.wall],
        ["tool", c.tool],
        ["  of which gate/test/build", c.gate],
        ["model", c.model],
        ["machine (tool + model)", c.machine],
        ["idle", c.idle],
    ];
    return parts.map(
        ([label, s]) =>
            `  ${pad(label, 26, false)} ${pad(mins(s.median), 8)} ${pad(
                mins(s.p90),
                8
            )} ${pad(mins(s.mean), 8)}`
    );
}

/** Render the cohorts as one plain-text receipt, safe to paste into a PR. */
export function formatReport(
    from: string,
    to: string,
    cohorts: Cohort[],
    maxHours: number
): string {
    const out: string[] = [];
    out.push(
        `latency per issue — ${from} → ${to} (sessions over ${maxHours}h excluded)`
    );
    for (const c of cohorts) {
        out.push("");
        out.push(`  ${c.name} — ${c.sessions} sessions`);
        out.push(
            `  ${pad("component", 26, false)} ${pad("median", 8)} ${pad(
                "p90",
                8
            )} ${pad("mean", 8)}`
        );
        out.push(...cohortRows(c));
    }
    return out.join("\n");
}
