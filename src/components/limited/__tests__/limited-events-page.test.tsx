// Events page "your CURRENT events" wiring (issue #1578, narrowed to
// in-progress-only by issue #2357): `myCurrentLimitedEvents` /
// `useMyCurrentLimitedEvents` backs this page's own seated-events section, so
// a started event vanished from the page the moment `listOpenLimitedEvents`
// stopped listing it — a participant who navigated away had no in-app way
// back short of a bookmarked/shared URL. Drives the SURFACE assertion
// through the real page component (not a hand-built view), mirroring
// `limited-vs-ai-panel.test.tsx`'s mocking discipline. A concluded event
// drops off this section entirely and lives on `/limited/events` instead
// (`LimitedYourEventsPage`) — this file covers the narrowed section + the
// "Your Events (all)" link out to that page, not the full-history page
// itself.
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
const myCurrentEventsMock = vi.fn();
const draftableSetsMock = vi.fn();

vi.mock("~/hooks/useLimitedEvent", () => ({
    useOpenLimitedEvents: () => openEventsMock(),
    useMyCurrentLimitedEvents: () => myCurrentEventsMock(),
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

describe("LimitedEventsPage — your CURRENT events section (issue #1578, narrowed by #2357)", () => {
    it("lists a seated STARTED event under 'Your Current Events' even though it's absent from the open-events list", () => {
        openEventsMock.mockReturnValue([]);
        myCurrentEventsMock.mockReturnValue([makeEvent({ status: "started" })]);

        render(<LimitedEventsPage />);

        expect(screen.getByText("Your Current Events")).toBeTruthy();
        expect(screen.getByText(/sealed/i)).toBeTruthy();
        // The row shows the derived PHASE, not the raw `status` enum (ADR
        // 0076): a started Sealed event with no decks in yet is
        // "deckbuilding". "started" is a DB state; the phase is what the
        // player is actually doing — and with four lifecycle statuses the raw
        // enum would report a running event as "completed".
        expect(screen.getByText(/deckbuilding/)).toBeTruthy();
    });

    it("navigates to the event detail page when its View button is clicked", () => {
        openEventsMock.mockReturnValue([]);
        myCurrentEventsMock.mockReturnValue([makeEvent({ status: "started" })]);

        render(<LimitedEventsPage />);

        fireEvent.click(screen.getByText("View"));

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
        });
    });

    it("renders no 'Your Current Events' section when the viewer has no in-progress seated events", () => {
        openEventsMock.mockReturnValue([]);
        myCurrentEventsMock.mockReturnValue([]);

        render(<LimitedEventsPage />);

        expect(screen.queryByText("Your Current Events")).toBe(null);
    });

    it("navigates to /limited/events when 'Your Events (all)' is clicked (issue #2357)", () => {
        openEventsMock.mockReturnValue([]);
        myCurrentEventsMock.mockReturnValue([]);

        render(<LimitedEventsPage />);

        fireEvent.click(screen.getByText("Your Events (all) →"));

        expect(navigate).toHaveBeenCalledWith({ to: "/limited/events" });
    });
});
