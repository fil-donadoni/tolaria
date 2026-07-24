// Leave Seat / Cancel Event (issue #1579): an occupant can leave their Seat,
// the creator can cancel the whole event, while it's still OPEN — both gated
// behind a confirmation dialog and disabled while the mutation is in-flight
// (CLAUDE.md: UI buttons firing Convex mutations must disable while
// in-flight). Mirrors `limited-event-detail.test.tsx`'s mocking discipline.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventDetail from "../limited-event-detail";

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => [],
}));

const eventMock = vi.fn();
const leaveMock = vi.fn().mockResolvedValue(null);
const cancelMock = vi.fn().mockResolvedValue(null);

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEvent: () => eventMock(),
    useLimitedEventMutations: () => ({
        join: vi.fn(),
        leave: leaveMock,
        cancel: cancelMock,
        start: vi.fn(),
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    leaveMock.mockResolvedValue(null);
    cancelMock.mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
});

function makeEvent(overrides: Partial<LimitedEventView>): LimitedEventView {
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "open",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        viewerIncomingChallenges: [],
        viewerOutgoingChallenge: null,
        packSlots: ["lea"],
        seats: [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isBot: false,
                isViewer: true,
                poolCount: null,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
            },
            {
                seatIndex: 1,
                userId: undefined,
                nickname: undefined,
                isBot: false,
                isViewer: false,
                poolCount: null,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
            },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedEventDetail — Leave Seat (issue #1579)", () => {
    it("shows a Leave Seat button for an occupant of an OPEN event", () => {
        eventMock.mockReturnValue(makeEvent({ status: "open" }));
        render(<LimitedEventDetail eventId={"event-1" as never} />);
        expect(screen.getByText("Leave Seat")).toBeTruthy();
    });

    it("hides the Leave Seat button once the event has STARTED", () => {
        eventMock.mockReturnValue(makeEvent({ status: "started" }));
        render(<LimitedEventDetail eventId={"event-1" as never} />);
        expect(screen.queryByText("Leave Seat")).toBeNull();
    });

    it("hides the Leave Seat button for a viewer with no Seat in the event", () => {
        eventMock.mockReturnValue(
            makeEvent({
                status: "open",
                seats: [
                    {
                        seatIndex: 0,
                        userId: undefined,
                        nickname: undefined,
                        isBot: false,
                        isViewer: false,
                        poolCount: null,
                        pool: null,
                        currentPack: null,
                        packQueueCount: null,
                        pickDeadline: null,
                        autoBuiltDeck: null,
                    },
                ] as unknown as LimitedEventView["seats"],
            })
        );
        render(<LimitedEventDetail eventId={"event-1" as never} />);
        expect(screen.queryByText("Leave Seat")).toBeNull();
    });

    it("requires confirmation before calling the leave mutation", () => {
        eventMock.mockReturnValue(makeEvent({ status: "open" }));
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        fireEvent.click(screen.getByText("Leave Seat"));
        expect(leaveMock).not.toHaveBeenCalled();

        expect(screen.getByText("Leave this Seat?")).toBeTruthy();
        fireEvent.click(screen.getByText("Cancel"));
        expect(leaveMock).not.toHaveBeenCalled();
    });

    it("calls the leave mutation once the dialog is confirmed", () => {
        eventMock.mockReturnValue(makeEvent({ status: "open" }));
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        fireEvent.click(screen.getByText("Leave Seat"));
        // Two "Leave Seat" strings now exist — the (still-visible) action
        // button and the dialog's confirm button — the confirm button is the
        // last one rendered.
        const confirmButtons = screen.getAllByText("Leave Seat");
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);
        expect(leaveMock).toHaveBeenCalledWith({ eventId: "event-1" });
    });
});

describe("LimitedEventDetail — Cancel Event (issue #1579)", () => {
    it("shows a Cancel Event button for the creator of an OPEN event", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "user-1" })
        );
        render(<LimitedEventDetail eventId={"event-1" as never} />);
        expect(screen.getByText("Cancel Event")).toBeTruthy();
    });

    it("hides the Cancel Event button for a non-creator", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "admin-1" })
        );
        render(<LimitedEventDetail eventId={"event-1" as never} />);
        expect(screen.queryByText("Cancel Event")).toBeNull();
    });

    it("hides the Cancel Event button once the event has STARTED, even for the creator", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "started", createdBy: "user-1" })
        );
        render(<LimitedEventDetail eventId={"event-1" as never} />);
        expect(screen.queryByText("Cancel Event")).toBeNull();
    });

    it("requires confirmation before calling the cancel mutation", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "user-1" })
        );
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        fireEvent.click(screen.getByText("Cancel Event"));
        expect(cancelMock).not.toHaveBeenCalled();

        expect(screen.getByText("Cancel this event?")).toBeTruthy();
        fireEvent.click(screen.getByText("Keep Event"));
        expect(cancelMock).not.toHaveBeenCalled();
    });

    it("calls the cancel mutation once the dialog is confirmed", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "user-1" })
        );
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        fireEvent.click(screen.getByText("Cancel Event"));
        const confirmButtons = screen.getAllByText("Cancel Event");
        fireEvent.click(confirmButtons[confirmButtons.length - 1]);
        expect(cancelMock).toHaveBeenCalledWith({ eventId: "event-1" });
    });
});

describe("LimitedEventDetail — cancelled-out-from-under-viewer (issue #1579)", () => {
    it("renders a graceful 'no longer exists' state instead of crashing when getLimitedEvent returns null", () => {
        eventMock.mockReturnValue(null);
        render(<LimitedEventDetail eventId={"event-1" as never} />);
        expect(screen.getByText(/no longer exists/i)).toBeTruthy();
    });
});
