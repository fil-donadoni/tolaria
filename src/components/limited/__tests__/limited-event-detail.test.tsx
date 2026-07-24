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

    it("still shows the share/invite button once the event has STARTED", () => {
        eventMock.mockReturnValue(makeEvent({ status: "started" }));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Share invite link")).toBeTruthy();
    });

    it("still shows the share/invite button once the event is COMPLETED", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "started", completed: true })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Share invite link")).toBeTruthy();
    });
});
