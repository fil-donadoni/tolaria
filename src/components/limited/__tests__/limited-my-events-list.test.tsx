// "Your Current Events" list component (issue #1578, heading narrowed to
// in-progress-only by issue #2357): renders nothing when the viewer has no
// seated events, otherwise one row per event with only a View affordance
// (the viewer already has a Seat everywhere it appears, so Join never
// applies).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedMyEventsList from "../limited-my-events-list";

afterEach(() => {
    cleanup();
});

function makeEvent(overrides: Partial<LimitedEventView>): LimitedEventView {
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "started",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        packSlots: ["lea"],
        seats: [],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedMyEventsList (issue #1578)", () => {
    it("renders nothing (no empty-state banner) when there are no seated events", () => {
        const { container } = render(
            <LimitedMyEventsList events={[]} onOpen={vi.fn()} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders a row per event with no Join button (the viewer already has a Seat)", () => {
        render(
            <LimitedMyEventsList
                events={[makeEvent({ _id: "event-1", status: "started" })]}
                onOpen={vi.fn()}
            />
        );

        expect(screen.getByText("Your Current Events")).toBeTruthy();
        expect(screen.getByText("View")).toBeTruthy();
        expect(screen.queryByText("Join")).toBe(null);
    });

    it("calls onOpen with the event id when View is clicked", () => {
        const onOpen = vi.fn();
        render(
            <LimitedMyEventsList
                events={[makeEvent({ _id: "event-1" })]}
                onOpen={onOpen}
            />
        );

        fireEvent.click(screen.getByText("View"));

        expect(onOpen).toHaveBeenCalledWith("event-1");
    });
});
