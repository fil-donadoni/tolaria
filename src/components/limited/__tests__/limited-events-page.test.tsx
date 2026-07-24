// Events page "your events" wiring (issue #1578): `myLimitedEvents` /
// `useMyLimitedEvents` already existed but were wired to no component, so a
// started event vanished from the page the moment `listOpenLimitedEvents`
// stopped listing it — a participant who navigated away had no in-app way
// back short of a bookmarked/shared URL. Drives the SURFACE assertion
// through the real page component (not a hand-built view), mirroring
// `limited-vs-ai-panel.test.tsx`'s mocking discipline.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventsPage from "../limited-events-page";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

const openEventsMock = vi.fn();
const myEventsMock = vi.fn();
const draftableSetsMock = vi.fn();

vi.mock("~/hooks/useLimitedEvent", () => ({
    useOpenLimitedEvents: () => openEventsMock(),
    useMyLimitedEvents: () => myEventsMock(),
    useDraftableSets: () => draftableSetsMock(),
    useLimitedEventMutations: () => ({
        create: vi.fn(),
        join: vi.fn(),
        start: vi.fn(),
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    draftableSetsMock.mockReturnValue([]);
});

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
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedEventsPage — your events section (issue #1578)", () => {
    it("lists a seated STARTED event under 'Your Events' even though it's absent from the open-events list", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([makeEvent({ status: "started" })]);

        render(<LimitedEventsPage />);

        expect(screen.getByText("Your Events")).toBeTruthy();
        expect(screen.getByText(/sealed/i)).toBeTruthy();
        expect(screen.getByText(/started/)).toBeTruthy();
    });

    it("navigates to the event detail page when its View button is clicked", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([makeEvent({ status: "started" })]);

        render(<LimitedEventsPage />);

        fireEvent.click(screen.getByText("View"));

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
        });
    });

    it("renders no 'Your Events' section when the viewer has no seated events", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([]);

        render(<LimitedEventsPage />);

        expect(screen.queryByText("Your Events")).toBe(null);
    });
});
