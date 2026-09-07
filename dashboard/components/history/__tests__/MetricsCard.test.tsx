// Assertions read the DOM directly rather than through jest-dom's matchers —
// see the note in `NowView.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MetricsCard } from "../MetricsCard";
import type { HistoryChartData } from "../../../lib/historyData";
import {
    getSlice,
    resetHistoryState,
    setSlice,
} from "../../../lib/historyState";
import { GLOSSARY, lookupTerm } from "../../../glossary";
import { BY_SPLIT, TOTALS } from "./fixture";

/**
 * The metric Table card (PRD #3148 S3).
 *
 * ── THE CASE THIS FILE EXISTS FOR ─────────────────────────────────────────
 *
 * The picker's dataset and the rows' dataset DISAGREE for the whole time a
 * query is in flight: `setSlice` publishes synchronously on the click, and
 * `charts` only changes when the read lands. A card that labels its columns
 * off the picker paints one dataset's rows under another's column names for
 * that window — which is the hazard `HistoryChartData` carries `table` to
 * prevent, and which this card got wrong in review of PR #3176.
 *
 * It is observable because the glossary QUALIFIES: `agent_runs.total_seconds`
 * is subagent wall clock, the bare `total_seconds` is tool wall clock, and
 * `llm` has no entry of its own. So the tooltip on one header is a different
 * sentence depending on which dataset the card believes it is showing.
 */

const CHARTS: HistoryChartData = {
    perDay: [],
    bySplit: BY_SPLIT.rows,
    metrics: BY_SPLIT.metrics,
    total: TOTALS.rows[0],
    table: "agent_runs",
    split: "role",
    metric: "total_seconds",
};

const renderCard = (
    charts: HistoryChartData | null = CHARTS,
    error: string | null = null
) =>
    render(
        <TooltipProvider>
            <MetricsCard charts={charts} error={error} />
        </TooltipProvider>
    );

const hover = async (el: HTMLElement) => {
    fireEvent.pointerEnter(el, { pointerType: "mouse" });
    fireEvent.mouseEnter(el);
    await waitFor(() =>
        expect(el.getAttribute("data-popup-open")).not.toBeNull()
    );
};

const headerTrigger = (text: string): HTMLElement =>
    [
        ...screen
            .getByRole("table", { name: "Every metric for the current slice" })
            .querySelectorAll<HTMLElement>("thead span"),
    ].find((s) => s.textContent === text)!;

beforeEach(() => {
    resetHistoryState();
    vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("MetricsCard — the columns belong to the ROWS, not to the picker", () => {
    it("labels and explains its columns against the dataset the rows were fetched for, even while the picker has already moved on", async () => {
        // The exact mid-flight state: the click has published `llm`, the
        // `agent_runs` rows are still what is on screen.
        setSlice({ table: "llm", metric: "messages", split: "model" });
        renderCard();
        expect(getSlice().table).toBe("llm");

        await hover(headerTrigger(GLOSSARY.total_seconds.label));
        expect(
            screen.getByText(lookupTerm("agent_runs.total_seconds")!.tip)
        ).not.toBeNull();
        // Qualifying against the PICKER would fall back to the bare entry,
        // because `llm` has no `total_seconds` of its own.
        expect(screen.queryByText(GLOSSARY.total_seconds.tip)).toBeNull();
    });

    it("renders one row per split value and no raw column name in the header", () => {
        renderCard();
        const table = screen.getByRole("table", {
            name: "Every metric for the current slice",
        });
        expect(table.querySelectorAll("tbody tr").length).toBe(2);
        const head = table.querySelector("thead")!;
        expect(head.textContent).not.toContain("total_seconds");
        expect(head.textContent).not.toContain("out_tokens");
    });

    it("a header click writes the SHARED slice, so the sort survives a bookmark (#2635)", async () => {
        renderCard();
        const button = screen
            .getByRole("table", { name: "Every metric for the current slice" })
            .querySelector<HTMLElement>('th button[data-key="cost_usd"]')!;
        fireEvent.click(button);
        await waitFor(() => expect(getSlice().sort).toBe("cost_usd"));
        expect(getSlice().sortDir).toBe(-1);
        fireEvent.click(button);
        await waitFor(() => expect(getSlice().sortDir).toBe(1));
    });

    it("sorting does NOT re-run the queries — the rows are already here", async () => {
        const fetchSpy = vi.fn();
        vi.stubGlobal("fetch", fetchSpy);
        renderCard();
        fireEvent.click(
            screen
                .getByRole("table", {
                    name: "Every metric for the current slice",
                })
                .querySelector<HTMLElement>('th button[data-key="cost_usd"]')!
        );
        await waitFor(() => expect(getSlice().sort).toBe("cost_usd"));
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("before the first read lands it says so, rather than rendering a table with no columns", () => {
        renderCard(null);
        // A `<thead>` with zero cells and a body cell spanning zero columns
        // reads as "this slice has no rows".
        expect(screen.queryByRole("table")).toBeNull();
        expect(screen.getByText(/reading the telemetry store/)).not.toBeNull();
    });

    it("a failed aggregate read renders the unavailable state, never an empty table", () => {
        renderCard(null, "no such column: total_seconds");
        expect(screen.getByRole("status").textContent).toContain(
            "no such column: total_seconds"
        );
        expect(screen.queryByRole("table")).toBeNull();
    });
});
