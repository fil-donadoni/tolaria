// Share/invite affordance stays reachable after the event starts (issue
// #1578): previously gated to `status === "open"`, so a participant who
// left the page (or received the link secondhand) had no in-app way to
// re-copy it once the event was underway. Drives the SURFACE assertion
// through the real `LimitedEventDetail` render, mirroring
// `limited-vs-ai-panel.test.tsx`'s mocking discipline.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventDetail from "../limited-event-detail";

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

// `LimitedVsAiPanel` renders for any started+pool-final event with a viewer
// seat — pull in its own mocking discipline (`limited-vs-ai-panel.test.tsx`)
// so a STARTED-status fixture here doesn't crash on a missing ConvexProvider.
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

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEvent: () => eventMock(),
    useLimitedEventMutations: () => ({
        join: vi.fn(),
        start: vi.fn(),
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
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
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedEventDetail — share/invite reachable post-start (issue #1578)", () => {
    it("shows the share/invite button for an OPEN event", () => {
        eventMock.mockReturnValue(makeEvent({ status: "open" }));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Share invite link")).toBeTruthy();
    });

    it("still shows the link button once the event has STARTED — as a plain event link, not an invite", () => {
        eventMock.mockReturnValue(makeEvent({ status: "started" }));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Copy event link")).toBeTruthy();
        expect(screen.queryByText("Share invite link")).toBe(null);
    });

    it("still shows the link button once the event is COMPLETED", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "started", completed: true })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Copy event link")).toBeTruthy();
    });
});

describe("LimitedEventDetail — start hint follows the Start button", () => {
    const HINT = /You can start the event at any time/;

    it("shows the hint to the creator while the event is still open", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "user-1" })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText(HINT)).toBeTruthy();
    });

    it("hides the hint for a non-creator (no Start button to explain)", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "someone-else" })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText(HINT)).toBe(null);
    });

    it("hides the hint once the event has started", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "started", createdBy: "user-1" })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText(HINT)).toBe(null);
    });
});

describe("LimitedEventDetail — header (format name + phase chip)", () => {
    it("titles the page with the event's format name, not the raw type/packSlots", () => {
        eventMock.mockReturnValue(
            makeEvent({
                type: "draft",
                status: "started",
                packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
            })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Vintage Cube Draft")).toBeTruthy();
        expect(screen.queryByText(/VINTAGE-CUBE, VINTAGE-CUBE/)).toBe(null);
    });

    it("shows the PHASE (drafting) rather than the raw DB status (started)", () => {
        eventMock.mockReturnValue(
            makeEvent({ type: "draft", status: "started", packSlots: ["lea"] })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("drafting")).toBeTruthy();
        expect(screen.queryByText(/started/)).toBe(null);
    });
});
