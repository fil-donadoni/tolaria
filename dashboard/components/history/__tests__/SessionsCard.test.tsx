// Assertions read the DOM directly rather than through jest-dom's matchers —
// see the note in `NowView.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionsCard } from "../SessionsCard";
import { GLOSSARY } from "../../../glossary";
import { SESSIONS, stubHistoryFetch } from "./fixture";
import type { SessionsPayload } from "../../../lib/historyPayload";

/**
 * The Sessions card (#2634/#2635, ported in PRD #3148 S3).
 *
 * The column worth its own case is `prs`: the cell renders a COUNT of a JSON
 * array the row carries as a STRING, so it is the one column whose sort value
 * is not a field on the row. The fixture picks `["#9"]` against
 * `["#3170","#3171"]` deliberately — those two sort one way by string and the
 * other way by count, so a table that dropped `sortValue` fails here and
 * passes any test that only asked whether the order changed.
 */

const renderCard = (
    payload: SessionsPayload | null = SESSIONS,
    error: string | null = null
) => {
    const stub = stubHistoryFetch();
    vi.stubGlobal("fetch", vi.fn(stub.fetchStub));
    return render(
        <TooltipProvider>
            <SessionsCard payload={payload} error={error} />
        </TooltipProvider>
    );
};

const table = () => screen.getByRole("table", { name: "Sessions in range" });

const sortButton = (key: string): HTMLElement =>
    table().querySelector<HTMLElement>(`th button[data-key="${key}"]`)!;

const order = () =>
    [...table().querySelectorAll("tbody tr")].map((tr) =>
        tr.getAttribute("data-row")
    );

beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Sessions table", () => {
    it("renders headers as glossary phrases, and `title` uses the SESSION-TITLE entry rather than the bare session dimension", () => {
        renderCard();
        const head = table().querySelector("thead")!;
        expect(head.textContent).toContain(
            GLOSSARY["history.session-title"].label
        );
        expect(head.textContent).not.toContain("wall_min");
        expect(head.textContent).not.toContain("orch_cost");
    });

    it("falls back to the head of the session id when a session has no title yet", () => {
        renderCard();
        expect(table().textContent).toContain("9cc33dd4");
    });

    it("reads wall-clock minutes as elapsed time, not as a bare number", () => {
        renderCard();
        // 134 minutes → 2h 14m.
        expect(table().textContent).toContain("2h 14m");
    });

    it("sorts `prs` by the COUNT it renders, not by the raw JSON string it stores", async () => {
        renderCard();
        fireEvent.click(sortButton("prs"));
        // Descending by count: 2, 1, 0.
        await waitFor(() =>
            expect(order()).toEqual([
                "0aa11bb2-3333-4444-5555-666677778888",
                "5ee55ff6-7777-8888-9999-aaaabbbbcccc",
                "9cc33dd4-5555-6666-7777-888899990000",
            ])
        );
        fireEvent.click(sortButton("prs"));
        // Ascending by count: 0, 1, 2. Ascending by STRING would put
        // `["#3170",…]` before `["#9"]`, i.e. 2 before 1.
        await waitFor(() =>
            expect(order()).toEqual([
                "9cc33dd4-5555-6666-7777-888899990000",
                "5ee55ff6-7777-8888-9999-aaaabbbbcccc",
                "0aa11bb2-3333-4444-5555-666677778888",
            ])
        );
    });

    it("filters by COMMAND FAMILY — the first word, so a command's arguments do not split one bucket into three", async () => {
        renderCard();
        fireEvent.change(screen.getByRole("combobox", { name: "command" }), {
            target: { value: "/next-issue" },
        });
        // Two sessions ran `/next-issue`, with different arguments.
        await waitFor(() => expect(order().length).toBe(2));
    });

    it("'no sessions at all' and 'filters hid them' read different sentences", async () => {
        renderCard({ rows: [] });
        expect(
            screen.getByText(GLOSSARY["empty.sessions.none"].tip)
        ).not.toBeNull();
    });

    it("...the filtered sentence, when a search matches nothing", async () => {
        renderCard();
        fireEvent.change(screen.getByPlaceholderText("title / command / id"), {
            target: { value: "zzzz" },
        });
        await waitFor(() =>
            expect(
                screen.getByText(GLOSSARY["empty.sessions.filtered"].tip)
            ).not.toBeNull()
        );
    });

    it("searches the session ID as well as the title — the id is the only handle an untitled session has", async () => {
        renderCard();
        fireEvent.change(screen.getByPlaceholderText("title / command / id"), {
            target: { value: "9cc33dd4" },
        });
        await waitFor(() =>
            expect(order()).toEqual(["9cc33dd4-5555-6666-7777-888899990000"])
        );
    });

    it("a failed read renders the unavailable state, never an empty table", () => {
        renderCard(null, "database is locked");
        expect(screen.getByRole("status").textContent).toContain(
            "database is locked"
        );
        expect(screen.queryByRole("table")).toBeNull();
    });
});
