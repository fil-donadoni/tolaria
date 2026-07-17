// "Seats" disclosure tests (F3, PRD #1107): during an active draft the per-seat
// roster collapses behind a compact summary and stays closed by default. Built
// on the real projection (`projectLimitedEvent`) so the view shape matches what
// the client actually receives, per the Frontend wiring rule.
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventSeatsDisclosure from "../limited-event-seats-disclosure";

afterEach(() => cleanup());

function draftRow(): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        seats: [
            { seatIndex: 0, userId: "user1", nickname: "Alice" },
            { seatIndex: 1, isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

function view(seatsWithDeck: number, completed = false): LimitedEventView {
    return projectLimitedEvent(
        draftRow(),
        "user1",
        completed,
        seatsWithDeck
    ) as unknown as LimitedEventView;
}

describe("LimitedEventSeatsDisclosure (F3)", () => {
    it("is collapsed by default — the per-seat rows are hidden, only the summary shows", () => {
        const { getByText, queryByText } = render(
            <LimitedEventSeatsDisclosure event={view(0)} />
        );
        // Compact summary is visible…
        expect(getByText("Seats · 2")).toBeTruthy();
        expect(getByText("0/2 decks in")).toBeTruthy();
        // …but the seat roster (nickname "Alice") is not rendered yet.
        expect(queryByText("Alice")).toBeNull();
    });

    it("expands to reveal the seat roster when the summary is clicked", () => {
        const { getByRole, getByText, queryByText } = render(
            <LimitedEventSeatsDisclosure event={view(1)} />
        );
        expect(queryByText("Alice")).toBeNull();
        fireEvent.click(getByRole("button"));
        expect(getByText("Alice")).toBeTruthy();
    });

    it("summarises completion once every seat has a deck", () => {
        const { getByText } = render(
            <LimitedEventSeatsDisclosure event={view(2, true)} />
        );
        expect(getByText("every seat has a deck")).toBeTruthy();
    });
});
