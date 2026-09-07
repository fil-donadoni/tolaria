import type { NowPayload, MergedPr } from "./nowPayload";

/**
 * The Now view's activity chart data (PRD #3148 S2), ported from
 * `scripts/dashboard/now-activity.js` (issue #3135) — one row per hour of the
 * last 24 for the tokens the models generated, with the pull requests merged
 * in that hour beside it.
 *
 * TWO SOURCES, NEITHER THE STORE. Tokens come from `/api/activity`, which
 * reads the session transcripts (`lib/live-activity.ts`) — the Now view reads
 * no `telemetry.db` (PRD #2621 D1), and a token count an ingest behind is
 * exactly the number that is useless when it is stale. Merges are
 * `recentMerges`, the SAME array the timeline's ticks read, bucketed here by
 * the hour they landed in; a failed merge read is declared rather than drawn
 * as a flat zero line.
 */

/** The chart's own window — restated from the server's
 *  `ACTIVITY_WINDOW_HOURS`; `now-activity`'s guard test keeps them equal. */
export const ACTIVITY_WINDOW_HOURS = 24;
export const HOUR_MS = 3_600_000;

/** Merged PRs per hour, keyed by the hour's start (epoch ms). */
export function mergesByHour(
    merges: MergedPr[] | null | undefined
): Map<number, number> {
    const out = new Map<number, number>();
    for (const m of merges ?? []) {
        const ts = Date.parse(m.mergedAt);
        if (!Number.isFinite(ts)) continue;
        // Fixed 3,600,000 ms steps, the server's own `hourStartOf` — never the
        // local wall-clock hour, which is unevenly spaced on a DST day.
        const hour = Math.floor(ts / HOUR_MS) * HOUR_MS;
        out.set(hour, (out.get(hour) ?? 0) + 1);
    }
    return out;
}

export interface ActivityRow {
    hourStart: number;
    outTok: number;
    inTok: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    messages: number;
    merged: number;
}

/**
 * The 24 rows the chart draws: the window's hours ending at the current one,
 * ALWAYS 24 of them, each joined with the server's bucket (or zeros — a quiet
 * hour is a zero bar, never a missing one) and with the merges that landed in
 * it. The frame is built here rather than trusted from the payload so a short
 * or stale bucket list still draws a full axis.
 */
export function activityRows(data: NowPayload, nowMs: number): ActivityRow[] {
    const byHour = new Map(
        (data.activity?.buckets ?? []).map((b) => [b.hourStart, b])
    );
    const merges = mergesByHour(data.recentMerges);
    const last = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
    const rows: ActivityRow[] = [];
    for (let i = ACTIVITY_WINDOW_HOURS - 1; i >= 0; i--) {
        const hourStart = last - i * HOUR_MS;
        const b = byHour.get(hourStart);
        rows.push({
            hourStart,
            outTok: b?.outTok ?? 0,
            inTok: b?.inTok ?? 0,
            cacheRead: b?.cacheRead ?? 0,
            cacheWrite: b?.cacheWrite ?? 0,
            cost: b?.cost ?? 0,
            messages: b?.messages ?? 0,
            merged: merges.get(hourStart) ?? 0,
        });
    }
    return rows;
}

/** A "nice" axis ceiling for a max — 1/2/2.5/5 × 10^n, at least 1. */
export function niceCeiling(max: number): number {
    if (!(max > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    for (const m of [1, 2, 2.5, 5, 10]) {
        if (m * mag >= max) return m * mag;
    }
    return mag * 10;
}
