import { isAdditive } from "./format";
import { MAX_SERIES } from "./historyColors";
import type { MetricRow } from "./historyPayload";

/**
 * The "Over time" card's SHAPE, computed away from the drawing (PRD #3148 S3)
 * — ported from `scripts/dashboard/history-timeline.js` (#2625/#2633).
 *
 * Every decision this card makes is a statistical one, and none of them is
 * about SVG: whether the metric may be stacked at all, how series are ranked,
 * where the eighth one ends and "Other" begins, and whether a day with no rows
 * for a series is a zero or a gap. Those belong in a function that takes rows
 * and returns numbers — which is also the only way to test them without
 * measuring a path string.
 */

/** The fold-in series' name. A literal, in one place, because it is BOTH a
 *  map key and rendered text — two spellings is one typo away from a series
 *  that draws under a name the legend does not have. */
export const OTHER_KEY = "Other";

export interface TimelineShape {
    /** Every day in range that has at least one row, ascending. */
    days: string[];
    /** The series to draw, in rank order, with `"Other"` last when the tail
     *  was folded. */
    seriesKeys: string[];
    /** `day → series → value`. A series ABSENT from a day's map is a gap, not
     *  a zero — see `additive` below. */
    stack: Map<string, Map<string, number>>;
    /** Whether the metric SUMS. Decides everything: stacked bars vs lines,
     *  whether the tail may fold into "Other", and how series are ranked. */
    additive: boolean;
    /** Series dropped rather than folded — non-additive only, where folding
     *  would mean averaging averages. */
    dropped: number;
    /** The largest value any column reaches: the stacked total when the metric
     *  sums, the single largest point when it does not. */
    max: number;
}

export function timelineShape(
    rows: readonly MetricRow[],
    split: string,
    metric: string
): TimelineShape {
    const additive = isAdditive(metric);
    const days = [...new Set(rows.map((r) => String(r.day)))].sort();
    const keys = [...new Set(rows.map((r) => String(r[split])))];

    // Series are ranked by their TOTAL when the metric sums and by their PEAK
    // when it does not — ranking a mean by a running sum would order series by
    // how many days they happen to appear on.
    const rank = new Map<string, number>();
    for (const r of rows) {
        const k = String(r[split]);
        const v = Number(r[metric] ?? 0);
        const prev = rank.get(k) ?? 0;
        rank.set(k, additive ? prev + v : Math.max(prev, v));
    }

    // Past eight series the palette stops being distinguishable, so the tail
    // folds into one explicit "Other" rather than cycling hues. A mean or a
    // max CANNOT be folded — averaging averages is not the average — so for
    // those the tail is dropped and the subtitle says so.
    const ranked = [...keys].sort(
        (a, b) => (rank.get(b) ?? 0) - (rank.get(a) ?? 0)
    );
    const top = ranked.slice(0, MAX_SERIES);
    const fold = new Set(additive ? ranked.slice(MAX_SERIES) : []);
    const dropped = additive ? 0 : ranked.length - top.length;
    const seriesKeys = fold.size ? [...top, OTHER_KEY] : top;

    const stack = new Map(days.map((d) => [d, new Map<string, number>()]));
    for (const r of rows) {
        const key = String(r[split]);
        if (!additive && !top.includes(key)) continue;
        const k = fold.has(key) ? OTHER_KEY : key;
        const m = stack.get(String(r.day));
        if (!m) continue;
        // Only a sum composes across rows; a mean or a max from the server is
        // already the value for that (day, series) cell.
        m.set(
            k,
            additive
                ? (m.get(k) ?? 0) + Number(r[metric] ?? 0)
                : Number(r[metric] ?? 0)
        );
    }

    const max = Math.max(
        0,
        ...days.map((d) => {
            const vals = [...(stack.get(d)?.values() ?? [])];
            return additive
                ? vals.reduce((a, b) => a + b, 0)
                : Math.max(0, ...vals);
        })
    );

    return { days, seriesKeys, stack, additive, dropped, max };
}

/**
 * The card's subtitle, after the glossary's fixed question.
 *
 * It states the one thing a reader cannot see: whether the columns are a
 * stack (so their heights add up) or independent lines (so they do not), and
 * what happened to any series past the eighth.
 */
export function timelineSubtitle(
    shape: Pick<TimelineShape, "additive" | "dropped">,
    metricLabel: string
): string {
    if (shape.additive)
        return 'Stacked; series past the eighth fold into "Other".';
    return (
        `Not stacked — ${metricLabel} is a per-row statistic, so its parts do not add up.` +
        (shape.dropped > 0
            ? ` Top ${MAX_SERIES} series shown; ${shape.dropped} omitted.`
            : "")
    );
}
