// Assertions read the DOM directly rather than through jest-dom's matchers —
// the `types` array in this project's tsconfig doesn't pick up jest-dom's type
// augmentation, so those matchers type-check as missing under `tsc -b` even
// though they run fine (same workaround as `NowView.test.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import HistoryView from "../HistoryView";
import { resetHistoryData } from "../../../lib/historyData";
import { resetHistoryState } from "../../../lib/historyState";
import { resetHistoryColors } from "../../../lib/historyColors";
import { getMetaLine, resetMetaLine } from "../../../lib/metaLine";
import { stubHistoryFetch, type StubOptions } from "./fixture";

/**
 * The History view against a GOLDEN STORE (PRD #3148 S3).
 *
 * "Every History panel renders against a fixture database with the same
 * figures as today" is the AC, and the figures are asserted as the strings an
 * operator READS. Two properties get their own cases because they are the ones
 * a port silently loses:
 *
 * - the three error channels are INDEPENDENT. `/api/meta` failing takes the
 *   whole view (there is no store); either of the other two failing must leave
 *   the OTHER half of the page drawn. The vanilla code got this right by
 *   writing headings before awaiting, which is the kind of ordering a port
 *   drops without noticing.
 * - a failed read is never an empty one. At 0/5000 GraphQL quota the Now panel
 *   once rendered "no claimed issues" while GitHub was unreachable (#2519
 *   round 3, finding 5); the same confusion here would read as "this range had
 *   no issues".
 */

const renderHistory = (options: StubOptions = {}) => {
    const stub = stubHistoryFetch(options);
    vi.stubGlobal("fetch", vi.fn(stub.fetchStub));
    return {
        ...stub,
        ...render(
            <TooltipProvider>
                <HistoryView />
            </TooltipProvider>
        ),
    };
};

beforeEach(() => {
    resetHistoryData();
    resetHistoryState();
    resetHistoryColors();
    resetMetaLine();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("HistoryView — every panel, against the fixture store", () => {
    it("renders the tiles with the store's totals, in the units their metric names imply", async () => {
        renderHistory();
        // `total_seconds` reads as elapsed time, never as `14400`.
        expect(await screen.findByText("4h 0m")).not.toBeNull();
        // `cost_usd` reads as dollars, `runs` as a whole tally.
        expect(screen.getByText("$48.75")).not.toBeNull();
        expect(screen.getByText("16")).not.toBeNull();
    });

    it("the leading split value's tile states its SHARE, because the metric sums", async () => {
        renderHistory();
        // implement: 12 600 of 14 400 total seconds = 88%.
        expect(await screen.findByText(/88% of total/)).not.toBeNull();
    });

    it("draws the ranking card with a direct value label per bar — a bar is never the only carrier of its own magnitude", async () => {
        renderHistory();
        const chart = await screen.findByRole("group", {
            name: /ranked$/,
        });
        // 12 600s and 1 800s, in the metric's own unit, inside the SVG.
        expect(chart.textContent).toContain("3h 30m");
        expect(chart.textContent).toContain("30m 0s");
        // The row labels, so the values are attributable.
        expect(chart.textContent).toContain("implement");
        expect(chart.textContent).toContain("review");
    });

    it("renders the metric table with one row per split value and every metric as a column", async () => {
        renderHistory();
        const table = await screen.findByRole("table", {
            name: "Every metric for the current slice",
        });
        const headers = [...table.querySelectorAll("thead th")].map((th) =>
            th.textContent?.trim()
        );
        // Glossary labels, never raw column names.
        expect(headers).not.toContain("total_seconds");
        expect(table.querySelectorAll("tbody tr").length).toBe(2);
    });

    it("renders the Issues card with the fixup-rate headline and per-issue figures", async () => {
        renderHistory();
        expect(
            await screen.findByText(
                /opus: 1\/4 with fixup · sonnet: 0\/2 with fixup/
            )
        ).not.toBeNull();
        // 42.4 minutes is a whole minute mark, never `42.4'`.
        expect(screen.getByText("42'")).not.toBeNull();
        expect(screen.getByText("#3152")).not.toBeNull();
    });

    it("renders the Sessions card, reading a null title as the session id's head and a null prs as zero", async () => {
        renderHistory();
        const table = await screen.findByRole("table", {
            name: "Sessions in range",
        });
        expect(table.textContent).toContain("port the History view");
        // The untitled session falls back to the first eight of its id.
        expect(table.textContent).toContain("9cc33dd4");
    });

    it("folds a role outside the four fixed columns into `support` rather than dropping it", async () => {
        renderHistory();
        const table = await screen.findByRole("table", {
            name: "Agent family by role",
        });
        const dashboard = [...table.querySelectorAll("tbody tr")].find((tr) =>
            tr.textContent?.startsWith("dashboard")
        );
        // `verify` (2 minutes, $0.50) is not one of the four columns and must
        // land in `support` — 2' · $0.50 — not vanish.
        expect(dashboard?.textContent).toContain("2' · $0.50");
    });

    it("counts a family's issues as the MAX per role, never the sum — the same issues are counted once per role", async () => {
        renderHistory();
        const table = await screen.findByRole("table", {
            name: "Agent family by role",
        });
        const dashboard = [...table.querySelectorAll("tbody tr")].find((tr) =>
            tr.textContent?.startsWith("dashboard")
        );
        const cells = [...(dashboard?.querySelectorAll("td") ?? [])].map(
            (td) => td.textContent
        );
        // Three rows each report `issues: 4`; the cell says 4, not 12.
        expect(cells[1]).toBe("4");
    });

    it("publishes the store's own summary into the header line", async () => {
        renderHistory();
        await screen.findByText("4h 0m");
        await waitFor(() =>
            expect(getMetaLine()).toContain("12,345 spans · 6,789 messages")
        );
        expect(getMetaLine()).toContain("2026-08-01 → 2026-08-03");
    });
});

describe("HistoryView — the three error channels are independent", () => {
    it("a missing telemetry store renders the unavailable state and nothing else — never a blank panel", async () => {
        renderHistory({ metaError: "no such table: agent_runs" });
        const banner = await screen.findByRole("status");
        expect(banner.textContent).toContain("no telemetry store");
        expect(banner.textContent).toContain("no such table: agent_runs");
        // And it says what the operator can now not know, plus that the Now
        // view is unaffected — the #2519 guarantee, in words.
        expect(banner.textContent).toContain("telemetry:ingest");
        expect(screen.queryByRole("table")).toBeNull();
    });

    it("a failed narrative read leaves the CHARTS drawn, and says the rows are unavailable rather than showing none", async () => {
        renderHistory({ narrativeError: "database is locked" });
        // The charts still have their figures.
        expect(await screen.findByText("4h 0m")).not.toBeNull();
        const banners = await screen.findAllByRole("status");
        expect(banners.length).toBeGreaterThanOrEqual(3);
        expect(
            banners.some((b) => b.textContent?.includes("database is locked"))
        ).toBe(true);
        // The distinction that matters: this is NOT the empty state.
        expect(screen.queryByText(/No sessions ran/)).toBeNull();
    });

    it("a failed aggregate read leaves the NARRATIVE cards drawn", async () => {
        renderHistory({ queryError: "no such column: total_seconds" });
        expect(await screen.findByText("#3152")).not.toBeNull();
        const banners = await screen.findAllByRole("status");
        expect(
            banners.some((b) =>
                b.textContent?.includes("no such column: total_seconds")
            )
        ).toBe(true);
    });
});
