// Assertions read the DOM directly rather than through jest-dom's matchers —
// see the note in `NowView.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IssuesCard } from "../IssuesCard";
import { GLOSSARY } from "../../../glossary";
import { ISSUES, RUNS, stubHistoryFetch } from "./fixture";
import type { IssuesPayload } from "../../../lib/historyPayload";

/**
 * The Issues card (#2634 — glossary headers, formatted cells, empty states;
 * #2635 — the issue link; ported in PRD #3148 S3).
 *
 * SORTING IS ASSERTED ON A PAIR THAT DISCRIMINATES. `$17.25` and `$2.50` sort
 * one way as numbers and the other way as text, so a table that compared the
 * RENDERED cell — the defect #2634 recorded — fails this and passes a check
 * that only asked whether the order changed.
 */

const renderCard = (
    payload: IssuesPayload | null = ISSUES,
    error: string | null = null
) => {
    const stub = stubHistoryFetch();
    vi.stubGlobal("fetch", vi.fn(stub.fetchStub));
    return {
        ...stub,
        ...render(
            <TooltipProvider>
                <IssuesCard payload={payload} error={error} />
            </TooltipProvider>
        ),
    };
};

const bodyRows = () => [
    ...screen
        .getByRole("table", { name: "Per-issue spend by role" })
        .querySelectorAll("tbody tr"),
];

/** The sort control for one column, by its RAW key — several headers render a
 *  label containing the word "cost", and the sort identity is the key. */
const sortButton = (key: string): HTMLElement =>
    screen
        .getByRole("table", { name: "Per-issue spend by role" })
        .querySelector<HTMLElement>(`th button[data-key="${key}"]`)!;

const issueOrder = () =>
    bodyRows()
        .map((tr) => tr.getAttribute("data-row"))
        .filter((v): v is string => v !== null);

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Issues table — headers and cells", () => {
    it("renders every header as a glossary human phrase, never the old raw abbreviation", () => {
        renderCard();
        const head = screen
            .getByRole("table", {
                name: "Per-issue spend by role",
            })
            .querySelector("thead")!;
        expect(head.textContent).toContain(GLOSSARY.impl_min.label);
        expect(head.textContent).toContain(GLOSSARY.fixups.label);
        // The raw column names must not survive anywhere in the header row.
        expect(head.textContent).not.toContain("impl_min");
        expect(head.textContent).not.toContain("out_tok");
    });

    it("never prints a raw float — a fractional per-role figure goes through the shared formatter", () => {
        renderCard();
        const table = screen.getByRole("table", {
            name: "Per-issue spend by role",
        });
        // 42.4 minutes renders as a whole minute mark, 12.5 dollars as money.
        expect(table.textContent).toContain("42'");
        expect(table.textContent).not.toContain("42.4");
        expect(table.textContent).toContain("$12.50");
    });

    it("a per-role subtotal of zero is an EMPTY cell, but the grand total at zero is still a figure", () => {
        renderCard({
            ...ISSUES,
            rows: [{ ...ISSUES.rows[1], cost: 0, other_min: 0 }],
        });
        const cells = [...bodyRows()[0].querySelectorAll("td")];
        // "that role did nothing here" vs a measurement that happens to be 0.
        expect(cells[cells.length - 2].textContent).toBe("$0.00");
    });

    it("the issue cell links to the real GitHub issue, in its own tab (#2635)", () => {
        renderCard();
        const link = screen.getByRole("link", { name: "#3152" });
        expect(link.getAttribute("href")).toBe(
            "https://github.com/fil-donadoni/tolaria/issues/3152"
        );
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toContain("noopener");
    });
});

describe("Issues table — sorting", () => {
    it("sorts by the RAW field value, not the rendered cell text", async () => {
        renderCard();
        // Default: cost, descending — $17.25 then $2.50.
        expect(issueOrder()).toEqual(["3152", "3153"]);
        fireEvent.click(sortButton("cost"));
        // Ascending by NUMBER is $2.50 then $17.25. Ascending by TEXT would be
        // "$17.25" then "$2.50", because "1" sorts before "2".
        await waitFor(() => expect(issueOrder()).toEqual(["3153", "3152"]));
    });

    it("announces the sorted column to a screen reader, not only with an arrow", async () => {
        renderCard();
        const header = sortButton("cost").closest("th")!;
        expect(header.getAttribute("aria-sort")).toBe("descending");
        fireEvent.click(sortButton("cost"));
        await waitFor(() =>
            expect(header.getAttribute("aria-sort")).toBe("ascending")
        );
    });
});

describe("Issues table — filters and empty states", () => {
    it("an empty state is a SENTENCE — 'there is no data' when the read returned nothing", () => {
        renderCard({ rows: [] });
        expect(
            screen.getByText(GLOSSARY["empty.issues.none"].tip)
        ).not.toBeNull();
    });

    it("...and a DIFFERENT sentence when the filters hid everything — only one of the two means 'loosen a filter'", async () => {
        renderCard();
        fireEvent.change(screen.getByPlaceholderText("#N / title"), {
            target: { value: "no such issue" },
        });
        await waitFor(() =>
            expect(
                screen.getByText(GLOSSARY["empty.issues.filtered"].tip)
            ).not.toBeNull()
        );
        expect(
            screen.queryByText(GLOSSARY["empty.issues.none"].tip)
        ).toBeNull();
    });

    it("the header row survives an empty body — the table still says what it WOULD show", () => {
        renderCard({ rows: [] });
        const table = screen.getByRole("table", {
            name: "Per-issue spend by role",
        });
        expect(table.querySelectorAll("thead th").length).toBeGreaterThan(10);
    });

    it("a missing family is a filterable value, not an absence", async () => {
        renderCard();
        fireEvent.change(screen.getByRole("combobox", { name: "family" }), {
            target: { value: "(none)" },
        });
        await waitFor(() => expect(issueOrder()).toEqual(["3153"]));
    });

    it("a failed read renders the unavailable state, never an empty table", () => {
        renderCard(null, "database is locked");
        const banner = screen.getByRole("status");
        expect(banner.textContent).toContain("database is locked");
        expect(screen.queryByRole("table")).toBeNull();
    });
});

describe("Issues table — the drill-down", () => {
    it("expands a row into its subagent runs, and collapses it again", async () => {
        const stub = stubHistoryFetch();
        vi.stubGlobal("fetch", vi.fn(stub.fetchStub));
        render(
            <TooltipProvider>
                <IssuesCard payload={ISSUES} error={null} />
            </TooltipProvider>
        );
        fireEvent.click(screen.getByText("#3152").closest("tr")!);
        const panel = await screen.findByRole("table", {
            name: "Subagent runs for issue #3152",
        });
        expect(
            within(panel).getByText(RUNS.rows[0].description!)
        ).not.toBeNull();
        expect(stub.calls.some((c) => c === "/api/runs?issue=3152")).toBe(true);

        fireEvent.click(screen.getByText("#3152").closest("tr")!);
        await waitFor(() =>
            expect(
                screen.queryByRole("table", {
                    name: "Subagent runs for issue #3152",
                })
            ).toBeNull()
        );
    });

    it("clicking the issue LINK does not also toggle the drill-down — the click bubbles from the anchor to the row (#2635)", async () => {
        renderCard();
        fireEvent.click(screen.getByRole("link", { name: "#3152" }));
        // A plain row-level listener would have opened the panel here.
        await waitFor(() =>
            expect(
                screen.queryByRole("table", {
                    name: "Subagent runs for issue #3152",
                })
            ).toBeNull()
        );
    });
});
