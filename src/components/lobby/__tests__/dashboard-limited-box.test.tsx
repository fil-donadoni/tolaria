// First-class Limited dashboard box (issue #1582): equal-weight Panel next
// to DashboardPlayBox, Browse/Create action, and a quick re-entry list of the
// viewer's seated events with a status hint sourced from projected fields
// (`limitedEventStatusHint`, exercised through the real event shape here —
// not a hand-built status string).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import DashboardLimitedBox from "../dashboard-limited-box";

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

describe("DashboardLimitedBox (issue #1582)", () => {
    it("renders the Panel header and Browse/Create action even with no seated events", () => {
        render(
            <DashboardLimitedBox
                events={[]}
                onBrowse={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText("Limited")).toBeTruthy();
        expect(screen.getByText("Browse / Create Events")).toBeTruthy();
        expect(screen.queryByText("Your Events")).toBeNull();
    });

    it("fires onBrowse when the Browse/Create action is clicked", () => {
        const onBrowse = vi.fn();
        render(
            <DashboardLimitedBox
                events={[]}
                onBrowse={onBrowse}
                onOpen={vi.fn()}
            />
        );
        fireEvent.click(screen.getByText("Browse / Create Events"));
        expect(onBrowse).toHaveBeenCalledTimes(1);
    });

    it("lists a seated event with its status hint and opens it on click", () => {
        const onOpen = vi.fn();
        render(
            <DashboardLimitedBox
                events={[
                    makeEvent({
                        _id: "event-open",
                        status: "open",
                        type: "draft",
                    }),
                ]}
                onBrowse={vi.fn()}
                onOpen={onOpen}
            />
        );
        expect(screen.getByText("Your Events")).toBeTruthy();
        expect(screen.getByText("open")).toBeTruthy();
        fireEvent.click(screen.getByText(/draft/));
        expect(onOpen).toHaveBeenCalledWith("event-open");
    });

    it("derives 'drafting' for a started Draft with no final pool yet", () => {
        render(
            <DashboardLimitedBox
                events={[
                    makeEvent({
                        _id: "event-drafting",
                        status: "started",
                        type: "draft",
                        draftCompletedAt: undefined,
                        completed: false,
                    }),
                ]}
                onBrowse={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText("drafting")).toBeTruthy();
    });

    it("derives 'deckbuilding' for a started Sealed event with no deck yet", () => {
        render(
            <DashboardLimitedBox
                events={[
                    makeEvent({
                        _id: "event-deckbuilding",
                        status: "started",
                        type: "sealed",
                        completed: false,
                    }),
                ]}
                onBrowse={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText("deckbuilding")).toBeTruthy();
    });

    it("derives 'ready to play' once the event is completed", () => {
        render(
            <DashboardLimitedBox
                events={[
                    makeEvent({
                        _id: "event-ready",
                        status: "started",
                        type: "sealed",
                        completed: true,
                    }),
                ]}
                onBrowse={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.getByText("ready to play")).toBeTruthy();
    });

    it("lists every seated event, one row each", () => {
        render(
            <DashboardLimitedBox
                events={[
                    makeEvent({ _id: "event-1", status: "open" }),
                    makeEvent({ _id: "event-2", status: "started" }),
                ]}
                onBrowse={vi.fn()}
                onOpen={vi.fn()}
            />
        );
        expect(screen.getAllByText(/sealed/).length).toBe(2);
    });
});
