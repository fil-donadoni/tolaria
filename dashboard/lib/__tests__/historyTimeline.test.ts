import { describe, expect, it } from "vitest";
import { OTHER_KEY, timelineShape, timelineSubtitle } from "../historyTimeline";
import { MAX_SERIES } from "../historyColors";
import type { MetricRow } from "../historyPayload";

/**
 * The "Over time" card's statistics (PRD #3148 S3, ported from
 * `scripts/dashboard/history-timeline.js`).
 *
 * These are the assertions that stop the chart printing a number that measures
 * nothing. All four say the same thing from different angles: ONLY A SUM
 * COMPOSES. A mean or a max is a statistic of the rows in its own group, so it
 * may not be stacked, may not be folded into an "Other" series, and may not be
 * ranked by a running total.
 */

const rows = (...specs: [string, string, number][]): MetricRow[] =>
    specs.map(([day, role, v]) => ({ day, role, total_seconds: v }));

describe("timelineShape — an additive metric", () => {
    it("stacks, and folds everything past the eighth series into one explicit Other", () => {
        const specs: [string, string, number][] = [];
        for (let i = 0; i < MAX_SERIES + 3; i++)
            specs.push(["2026-08-01", `role-${i}`, MAX_SERIES + 3 - i]);
        const shape = timelineShape(rows(...specs), "role", "total_seconds");
        expect(shape.additive).toBe(true);
        expect(shape.seriesKeys.length).toBe(MAX_SERIES + 1);
        expect(shape.seriesKeys[MAX_SERIES]).toBe(OTHER_KEY);
        expect(shape.dropped).toBe(0);
        // The three folded series are SUMMED into Other, never dropped: the
        // column total must still equal the day's real total.
        expect(shape.stack.get("2026-08-01")?.get(OTHER_KEY)).toBe(3 + 2 + 1);
    });

    it("ranks series by their TOTAL — a series present on one big day outranks one present on many small ones", () => {
        const shape = timelineShape(
            rows(
                ["2026-08-01", "big", 100],
                ["2026-08-01", "steady", 10],
                ["2026-08-02", "steady", 10],
                ["2026-08-03", "steady", 10]
            ),
            "role",
            "total_seconds"
        );
        expect(shape.seriesKeys).toEqual(["big", "steady"]);
    });

    it("scales to the stacked COLUMN total, not to the largest single segment", () => {
        const shape = timelineShape(
            rows(
                ["2026-08-01", "a", 30],
                ["2026-08-01", "b", 40],
                ["2026-08-02", "a", 50]
            ),
            "role",
            "total_seconds"
        );
        expect(shape.max).toBe(70);
    });

    it("sums repeated rows for one (day, series) cell — the server may return more than one", () => {
        const shape = timelineShape(
            rows(["2026-08-01", "a", 5], ["2026-08-01", "a", 7]),
            "role",
            "total_seconds"
        );
        expect(shape.stack.get("2026-08-01")?.get("a")).toBe(12);
    });
});

describe("timelineShape — a metric that does NOT sum", () => {
    const avgRows = (...specs: [string, string, number][]): MetricRow[] =>
        specs.map(([day, role, v]) => ({ day, role, avg_ctx_k: v }));

    it("does not stack, drops the tail instead of folding it, and says how many", () => {
        const specs: [string, string, number][] = [];
        for (let i = 0; i < MAX_SERIES + 2; i++)
            specs.push(["2026-08-01", `role-${i}`, MAX_SERIES + 2 - i]);
        const shape = timelineShape(avgRows(...specs), "role", "avg_ctx_k");
        expect(shape.additive).toBe(false);
        // Averaging averages is not the average, so there is no "Other".
        expect(shape.seriesKeys).not.toContain(OTHER_KEY);
        expect(shape.seriesKeys.length).toBe(MAX_SERIES);
        expect(shape.dropped).toBe(2);
    });

    it("takes the server's value as-is for a cell rather than adding rows together", () => {
        const shape = timelineShape(
            avgRows(["2026-08-01", "a", 40], ["2026-08-01", "a", 60]),
            "role",
            "avg_ctx_k"
        );
        // 60, the last row for that cell — never 100, which would be a mean
        // added to a mean.
        expect(shape.stack.get("2026-08-01")?.get("a")).toBe(60);
    });

    it("scales to the largest single POINT, since the parts do not add up", () => {
        const shape = timelineShape(
            avgRows(["2026-08-01", "a", 30], ["2026-08-01", "b", 40]),
            "role",
            "avg_ctx_k"
        );
        expect(shape.max).toBe(40);
    });

    it("leaves a day with no rows for a series ABSENT — a gap is not a zero, and joining across it would invent a measurement", () => {
        const shape = timelineShape(
            avgRows(
                ["2026-08-01", "a", 10],
                ["2026-08-02", "b", 20],
                ["2026-08-03", "a", 30]
            ),
            "role",
            "avg_ctx_k"
        );
        expect(shape.days).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
        expect(shape.stack.get("2026-08-02")?.has("a")).toBe(false);
        expect(shape.stack.get("2026-08-02")?.get("a")).toBeUndefined();
    });
});

describe("timelineSubtitle — the sentence a reader cannot get from the marks", () => {
    it("says the columns stack, for a metric that sums", () => {
        expect(
            timelineSubtitle({ additive: true, dropped: 0 }, "total time")
        ).toContain("Stacked");
    });

    it("names the metric and says WHY it is not stacked", () => {
        const text = timelineSubtitle(
            { additive: false, dropped: 0 },
            "average context"
        );
        expect(text).toContain("average context");
        expect(text).toContain("do not add up");
        expect(text).not.toContain("omitted");
    });

    it("declares dropped series rather than leaving them silently missing", () => {
        expect(
            timelineSubtitle({ additive: false, dropped: 3 }, "average context")
        ).toContain("3 omitted");
    });
});
