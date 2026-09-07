import { esc, fmtTokens, fmtUsd, fmtClockMs } from "./format.js";
import {
    sectionHtml,
    statsHtml,
    unavailableHtml,
    emptyHtml,
} from "./now-atoms.js";

/**
 * The Now view's activity chart (issue #3135) — one bar per hour of the
 * last 24 for the tokens the models generated, with the pull requests
 * merged in that hour drawn over it as a line. Local time, oldest on the
 * left, the same axis the timeline above it uses.
 *
 * TWO SOURCES, NEITHER THE STORE. Tokens come from `/api/activity`, which
 * reads the session transcripts through `lib/live-activity.ts` — the Now
 * view reads no `telemetry.db` (PRD #2621 D1), and a token count an ingest
 * behind is exactly the number that is useless when it is stale. Merges are
 * `data.recentMerges`, the SAME array the timeline's merge ticks read, bucketed
 * here by the hour they landed in; a failed merge read is declared
 * (`recentMergesError`) rather than drawn as a flat zero line.
 *
 * PURE: `data` and `nowMs` in, an SVG-bearing HTML string out. No event
 * listeners — every bar's own numbers ride in a `data-tip` the tooltip
 * engine (`tooltip.js`) shows on hover and on focus, so a bar is reachable
 * from the keyboard like every other control on this page.
 */

/** The chart's own window — restated from the server's
 *  `ACTIVITY_WINDOW_HOURS` (a browser module cannot import the `.ts`);
 *  `now-activity.test.ts` keeps the two equal. */
export const ACTIVITY_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

/** Merged PRs per local hour, keyed by the hour's start (epoch ms). */
export function mergesByHour(merges) {
    const out = new Map();
    for (const m of merges ?? []) {
        const ts = Date.parse(m.mergedAt);
        if (!Number.isFinite(ts)) continue;
        const d = new Date(ts);
        d.setMinutes(0, 0, 0);
        const hour = d.getTime();
        out.set(hour, (out.get(hour) ?? 0) + 1);
    }
    return out;
}

/** The hour label on the axis — `14:00`, local. */
const hourLabel = (hourStart) => fmtClockMs(hourStart) ?? "";

/**
 * The 24 rows the chart draws: the window's hours ending at the current
 * one, ALWAYS 24 of them, each joined with the server's bucket for that hour
 * (or zeros — a quiet hour is a zero bar, never a missing one) and with the
 * merges that landed in it. The frame is built here rather than trusted
 * from the payload so a short or stale bucket list still draws a full axis.
 */
export function activityRows(data, nowMs) {
    const byHour = new Map(
        (data.activity?.buckets ?? []).map((b) => [b.hourStart, b])
    );
    const merges = mergesByHour(data.recentMerges);
    const last = new Date(nowMs);
    last.setMinutes(0, 0, 0);
    const rows = [];
    for (let i = ACTIVITY_WINDOW_HOURS - 1; i >= 0; i--) {
        const hourStart = last.getTime() - i * HOUR_MS;
        const b = byHour.get(hourStart) ?? {};
        rows.push({
            hourStart,
            outTok: b.outTok ?? 0,
            inTok: b.inTok ?? 0,
            cacheRead: b.cacheRead ?? 0,
            cacheWrite: b.cacheWrite ?? 0,
            cost: b.cost ?? 0,
            messages: b.messages ?? 0,
            merged: merges.get(hourStart) ?? 0,
        });
    }
    return rows;
}

/** A "nice" axis ceiling for a max — 1/2/2.5/5 × 10^n, at least 1. */
export function niceCeiling(max) {
    if (!(max > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(max)));
    for (const m of [1, 2, 2.5, 5, 10]) {
        if (m * mag >= max) return m * mag;
    }
    return mag * 10;
}

const W = 960;
const PAD_L = 62;
const PAD_R = 46;
const PAD_T = 14;
const PLOT_H = 150;
const AXIS_H = 28;
const H = PAD_T + PLOT_H + AXIS_H;

function tipText(r) {
    const end = fmtClockMs(r.hourStart + HOUR_MS) ?? "";
    return (
        `${hourLabel(r.hourStart)}–${end}\n` +
        `output tokens: ${fmtTokens(r.outTok)}\n` +
        `input tokens: ${fmtTokens(r.inTok)} · cache reads: ${fmtTokens(r.cacheRead)}\n` +
        `messages: ${fmtTokens(r.messages)} · cost: ${fmtUsd(r.cost)}\n` +
        `PRs merged: ${r.merged}`
    );
}

/** The SVG. */
export function activitySvg(rows) {
    const n = rows.length;
    const slot = (W - PAD_L - PAD_R) / n;
    const barW = Math.max(4, slot * 0.62);
    const maxTok = Math.max(0, ...rows.map((r) => r.outTok));
    const maxMerged = Math.max(0, ...rows.map((r) => r.merged));
    const tokTop = niceCeiling(maxTok);
    const mergeTop = Math.max(1, niceCeiling(maxMerged));
    const yTok = (v) => PAD_T + PLOT_H - (v / tokTop) * PLOT_H;
    const yMerge = (v) => PAD_T + PLOT_H - (v / mergeTop) * PLOT_H;
    const cx = (i) => PAD_L + i * slot + slot / 2;

    let out = "";
    // Grid + left axis (tokens), four steps.
    for (let k = 0; k <= 4; k++) {
        const v = (tokTop * k) / 4;
        const y = yTok(v);
        out += `<line x1="${PAD_L - 4}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--grid)" stroke-width="1"/>`;
        out += `<text x="${PAD_L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-secondary)" font-size="11">${esc(fmtTokens(v))}</text>`;
    }
    // Right axis (merges) — integer steps only.
    const mergeSteps = Math.min(4, mergeTop);
    for (let k = 0; k <= mergeSteps; k++) {
        const v = Math.round((mergeTop * k) / mergeSteps);
        const y = yMerge(v);
        out += `<text x="${W - PAD_R + 8}" y="${(y + 4).toFixed(1)}" text-anchor="start" fill="var(--series-2)" font-size="11">${v}</text>`;
    }
    // Bars.
    rows.forEach((r, i) => {
        const x = cx(i) - barW / 2;
        const y = yTok(r.outTok);
        const h = Math.max(r.outTok > 0 ? 2 : 0, PAD_T + PLOT_H - y);
        out += `<rect class="ls-act-bar" x="${x.toFixed(1)}" y="${(PAD_T + PLOT_H - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="var(--series-1)"/>`;
    });
    // Merge line + markers.
    const pts = rows.map(
        (r, i) => `${cx(i).toFixed(1)},${yMerge(r.merged).toFixed(1)}`
    );
    out += `<polyline points="${pts.join(" ")}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>`;
    rows.forEach((r, i) => {
        if (r.merged > 0) {
            out += `<circle cx="${cx(i).toFixed(1)}" cy="${yMerge(r.merged).toFixed(1)}" r="4" fill="var(--series-2)" stroke="var(--surface-1)" stroke-width="2"/>`;
        }
    });
    // Axis labels every 3 hours, plus the baseline.
    out += `<line x1="${PAD_L - 4}" x2="${W - PAD_R}" y1="${(PAD_T + PLOT_H).toFixed(1)}" y2="${(PAD_T + PLOT_H).toFixed(1)}" stroke="var(--axis)" stroke-width="1"/>`;
    rows.forEach((r, i) => {
        if (i % 3 !== n % 3) return;
        out += `<text x="${cx(i).toFixed(1)}" y="${PAD_T + PLOT_H + 18}" text-anchor="middle" fill="var(--text-secondary)" font-size="11">${esc(hourLabel(r.hourStart))}</text>`;
    });
    // Hit targets LAST so they sit above everything: one per hour, the
    // whole column, carrying that hour's numbers as a tooltip.
    rows.forEach((r, i) => {
        const x = PAD_L + i * slot;
        out += `<rect class="ls-act-hit" x="${x.toFixed(1)}" y="${PAD_T}" width="${slot.toFixed(1)}" height="${PLOT_H}" fill="transparent" tabindex="0" role="img" aria-label="${esc(tipText(r).replace(/\n/g, "; "))}" data-tip="${esc(tipText(r))}"/>`;
    });
    return (
        `<svg class="ls-act-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Output tokens and merged pull requests per hour, last ${ACTIVITY_WINDOW_HOURS} hours">` +
        out +
        `</svg>`
    );
}

const legendHtml = () =>
    `<div class="legend ls-act-legend">` +
    `<span><span class="sw" style="background:var(--series-1)"></span><span data-term="activity.outTok">output tokens</span></span>` +
    `<span><span class="sw" style="background:var(--series-2)"></span><span data-term="activity.merged">PRs merged</span></span>` +
    `</div>`;

/** The four figures above the chart — the window's totals. */
function summaryHtml(rows) {
    const outTok = rows.reduce((s, r) => s + r.outTok, 0);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    const merged = rows.reduce((s, r) => s + r.merged, 0);
    const busiest = rows.reduce(
        (best, r) => (r.outTok > best.outTok ? r : best),
        rows[0]
    );
    return statsHtml([
        {
            term: "activity.outTok",
            label: "output tokens, 24h",
            value: fmtTokens(outTok),
        },
        {
            term: "activity.cost",
            label: "list-price cost, 24h",
            value: fmtUsd(cost),
        },
        {
            term: "activity.merged",
            label: "PRs merged, 24h",
            value: String(merged),
        },
        {
            term: "activity.outTok",
            label: "busiest hour",
            value:
                busiest && busiest.outTok > 0
                    ? hourLabel(busiest.hourStart)
                    : "—",
            note:
                busiest && busiest.outTok > 0
                    ? `${fmtTokens(busiest.outTok)} output tokens`
                    : "",
        },
    ]);
}

export const ACTIVITY_SECTION_ID = "ls-section-activity";

/**
 * The whole section. `data.activityError` (the route failed) renders the
 * UNAVAILABLE note and no chart — a flat line of zeros would read as "a
 * quiet day", the exact lie this page's other sections refuse to tell.
 */
export function activitySectionHtml(data, nowMs = Date.now()) {
    if (data.activityError != null) {
        return sectionHtml({
            id: ACTIVITY_SECTION_ID,
            term: "section.activity",
            title: "Activity by hour",
            body: unavailableHtml(
                data.activityError,
                "cannot tell what ran in the last 24 hours — not the same as a quiet day"
            ),
        });
    }
    const rows = activityRows(data, nowMs);
    const mergesNote =
        data.recentMergesError != null
            ? unavailableHtml(
                  data.recentMergesError,
                  "the merged-PR line may be incomplete"
              )
            : "";
    const anything = rows.some((r) => r.outTok > 0 || r.merged > 0);
    const asOf = data.activity?.asOf
        ? ` · as of ${fmtClockMs(data.activity.asOf)}`
        : "";
    const body =
        summaryHtml(rows) +
        mergesNote +
        (anything
            ? `<div class="scroll ls-act-scroll">${activitySvg(rows)}</div>` +
              legendHtml()
            : emptyHtml(
                  `No tokens generated and nothing merged in the last ${ACTIVITY_WINDOW_HOURS} hours.`
              ));
    return sectionHtml({
        id: ACTIVITY_SECTION_ID,
        term: "section.activity",
        title: "Activity by hour",
        extra: `<span class="ls-section-meta">local time${esc(asOf)}</span>`,
        body,
    });
}
