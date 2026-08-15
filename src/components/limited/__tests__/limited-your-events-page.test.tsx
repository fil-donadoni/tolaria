// `/limited/events` (issue #2357): every event the viewer has ever sat at —
// in progress AND concluded — backed by `useMyLimitedEvents` (unchanged,
// every status). Drives the SURFACE assertion through the real page
// component, mirroring `limited-events-page.test.tsx`'s mocking discipline.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import LimitedYourEventsPage from "../limited-your-events-page";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

const myEventsMock = vi.fn();

vi.mock("~/hooks/useLimitedEvent", () => ({
    useMyLimitedEvents: () => myEventsMock(),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function makeEvent(
    overrides: Partial<LimitedEventSummaryView>
): LimitedEventSummaryView {
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
    } as unknown as LimitedEventSummaryView;
}

describe("LimitedYourEventsPage (issue #2357)", () => {
    it("shows a loading state while the query is still resolving", () => {
        myEventsMock.mockReturnValue(undefined);
        const { container } = render(<LimitedYourEventsPage />);
        expect(container.textContent).not.toMatch(/haven't sat/i);
    });

    it("shows the empty state when the viewer has never sat at an event", () => {
        myEventsMock.mockReturnValue([]);
        render(<LimitedYourEventsPage />);
        expect(
            screen.getByText(/haven't sat at a Limited Event yet/i)
        ).toBeTruthy();
    });

    it("lists a CONCLUDED event, with its phase chip and match record — the one place a finished event's outcome stays visible", () => {
        myEventsMock.mockReturnValue([
            makeEvent({
                _id: "event-finished",
                status: "finished",
                completed: true,
                viewerMatchRecord: { wins: 2, losses: 1, draws: 0 },
            }),
        ]);
        render(<LimitedYourEventsPage />);

        expect(screen.getByText(/finished/)).toBeTruthy();
        expect(screen.getByText(/2-1/)).toBeTruthy();
    });

    it("opens the event detail page when a row's View button is clicked", () => {
        myEventsMock.mockReturnValue([
            makeEvent({ _id: "event-finished", status: "finished" }),
        ]);
        render(<LimitedYourEventsPage />);

        fireEvent.click(screen.getByText("View"));

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-finished" },
        });
    });

    it("navigates back to /limited when the back link is clicked", () => {
        myEventsMock.mockReturnValue([]);
        render(<LimitedYourEventsPage />);

        fireEvent.click(screen.getByText("← Back to Limited Events"));

        expect(navigate).toHaveBeenCalledWith({ to: "/limited" });
    });
});
