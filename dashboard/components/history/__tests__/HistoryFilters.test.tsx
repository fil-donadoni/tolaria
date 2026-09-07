// Assertions read the DOM directly rather than through jest-dom's matchers —
// see the note in `NowView.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HistoryFilters } from "../HistoryFilters";
import { resetHistoryData } from "../../../lib/historyData";
import {
    getSlice,
    resetHistoryState,
    setSlice,
} from "../../../lib/historyState";
import { resetHistoryColors } from "../../../lib/historyColors";
import { GLOSSARY } from "../../../glossary";
import { META, stubHistoryFetch } from "./fixture";

/**
 * The shared filter bar (#2633 — "every option renders the glossary LABEL for
 * its raw name, never the raw name itself"; #2635 — the slice it writes).
 *
 * THE LABELS ARE THE FEATURE. `agent_runs`, `cmd_bucket`, `total_seconds` are
 * the engine's own column names, and before #2633 the picker offered them
 * verbatim. Every case below asserts the human phrase is on screen AND that
 * the raw key is not — a port that rendered both would pass a
 * "contains the label" check while leaving the page as unreadable as it was.
 */

const renderFilters = () => {
    const stub = stubHistoryFetch();
    vi.stubGlobal("fetch", vi.fn(stub.fetchStub));
    return {
        ...stub,
        ...render(
            <TooltipProvider>
                <HistoryFilters meta={META} />
            </TooltipProvider>
        ),
    };
};

const optionsOf = (name: string) =>
    [...screen.getByRole("combobox", { name }).querySelectorAll("option")].map(
        (o) => ({ value: o.value, text: o.textContent })
    );

beforeEach(() => {
    resetHistoryData();
    resetHistoryState();
    resetHistoryColors();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("History filter bar — glossary-sourced labels (#2633)", () => {
    it("renders the Dataset options as glossary labels, never raw table names", () => {
        renderFilters();
        const options = optionsOf("Dataset");
        expect(options).toEqual([
            { value: "agent_runs", text: GLOSSARY.agent_runs.label },
            { value: "llm", text: GLOSSARY.llm.label },
        ]);
        // The VALUE stays the raw key — the query layer and the URL round trip
        // both key on it, so only the visible text may change.
        expect(options.map((o) => o.text)).not.toContain("agent_runs");
    });

    it("renders the Metric options as glossary labels, qualified by the current dataset", () => {
        renderFilters();
        const texts = optionsOf("Metric").map((o) => o.text);
        expect(texts).toContain(GLOSSARY.total_seconds.label);
        expect(texts).toContain(GLOSSARY.cost_usd.label);
        expect(texts).not.toContain("total_seconds");
    });

    it("excludes `day` from Split by — it is the x-axis of every chart, and offering it as a series would draw one bar per day per day", () => {
        renderFilters();
        const values = optionsOf("Split by").map((o) => o.value);
        expect(values).not.toContain("day");
        expect(values).toEqual(["agent_id", "role", "model"]);
    });

    it("the 'Filter · <dimension>' caption reads the split's glossary label, not its raw key", () => {
        renderFilters();
        expect(screen.getByText(/^Filter ·/).textContent).toContain(
            GLOSSARY.role.label
        );
    });

    it("each picker's caption is EXPLAINABLE — it carries the tooltip for the CURRENT selection, so the label is a door and not decoration", () => {
        renderFilters();
        // `DynamicTerm` renders a plain fragment when a term does not resolve
        // and a help-cursor trigger when it does, so the trigger treatment IS
        // the observable form of "the term resolved".
        for (const caption of ["Dataset", "Metric", "Split by"]) {
            const label = screen.getByText(caption);
            expect(label.className, caption).toContain("cursor-help");
        }
    });
});

describe("History filter bar — what a write carries with it (#2635)", () => {
    it("changing the DATASET clears the chip filters and the table sort, and coerces the metric to one the new dataset has", async () => {
        renderFilters();
        setSlice({
            filters: { role: ["review"] },
            sort: "total_seconds",
            sortDir: 1,
        });
        fireEvent.change(screen.getByRole("combobox", { name: "Dataset" }), {
            target: { value: "llm" },
        });
        await waitFor(() => expect(getSlice().table).toBe("llm"));
        // Chips name values of a dimension `llm` may not have; a sort names a
        // metric it may not have. Carrying either across is how a filter comes
        // to hide every row for a reason nothing on screen explains.
        expect(getSlice().filters).toEqual({});
        expect(getSlice().sort).toBeNull();
        // `total_seconds` is not an `llm` metric — coerced to its first.
        expect(getSlice().metric).toBe("messages");
        expect(getSlice().split).toBe("model");
    });

    it("changing the SPLIT clears the sort — one column over, the same reason", async () => {
        renderFilters();
        setSlice({ sort: "total_seconds" });
        fireEvent.change(screen.getByRole("combobox", { name: "Split by" }), {
            target: { value: "model" },
        });
        await waitFor(() => expect(getSlice().split).toBe("model"));
        expect(getSlice().sort).toBeNull();
    });

    it("a chip toggles into the filter map, and toggling it back DELETES the key rather than leaving an empty array", async () => {
        renderFilters();
        const chip = screen.getByRole("button", { name: "review" });
        fireEvent.click(chip);
        await waitFor(() =>
            expect(getSlice().filters).toEqual({ role: ["review"] })
        );
        fireEvent.click(screen.getByRole("button", { name: "review" }));
        // An empty array would serialise as `?filters={"role":[]}` and read as
        // "filtered to nothing" on the next load.
        await waitFor(() => expect(getSlice().filters).toEqual({}));
    });

    it("a chip's pressed state is `aria-pressed`, not a class the eye reads and a screen reader does not", async () => {
        renderFilters();
        expect(
            screen
                .getByRole("button", { name: "review" })
                .getAttribute("aria-pressed")
        ).toBe("false");
        fireEvent.click(screen.getByRole("button", { name: "review" }));
        await waitFor(() =>
            expect(
                screen
                    .getByRole("button", { name: "review" })
                    .getAttribute("aria-pressed")
            ).toBe("true")
        );
    });

    it("a date change writes the slice and re-reads the store for the new range", async () => {
        const { calls } = renderFilters();
        fireEvent.change(screen.getByLabelText("From"), {
            target: { value: "2026-08-02" },
        });
        await waitFor(() => expect(getSlice().from).toBe("2026-08-02"));
        await waitFor(() =>
            expect(calls.some((c) => c.includes("from=2026-08-02"))).toBe(true)
        );
    });
});
