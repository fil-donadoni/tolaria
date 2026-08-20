// The merged `/limited` list (issue #2590): status chips + a "mine" filter
// over the UNION of open events and every event the viewer has ever sat in.
// Drives the SURFACE assertion through the real page component (not a
// hand-built view), mirroring `limited-vs-ai-panel.test.tsx`'s mocking
// discipline. `mine`/`status`/`onMineChange`/`onStatusChange` are passed as
// props (owned by `limited-events.route.tsx`'s `useSearch`/`useNavigate`
// wiring) rather than read from the router here, so this file can drive every
// filter combination without mocking `useSearch`.
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

function renderPage(
    props: Partial<{
        mine: boolean;
        status:
            | "open"
            | "drafting"
            | "building"
            | "playing"
            | "done"
            | undefined;
        onMineChange: (next: boolean) => void;
        onStatusChange: (next: string | undefined) => void;
    }> = {}
) {
    return render(
        <LimitedEventsPage
            mine={props.mine ?? false}
            status={props.status}
            onMineChange={props.onMineChange ?? vi.fn()}
            onStatusChange={props.onStatusChange ?? vi.fn()}
        />
    );
}

describe("LimitedEventsPage — merged list (issue #2590)", () => {
    it("unions an open event nobody has joined with an event the viewer sat in — both appear with no filter", () => {
        openEventsMock.mockReturnValue([
            makeEvent({
                _id: "event-open",
                status: "open",
                seats: [],
            }),
        ]);
        myEventsMock.mockReturnValue([
            makeEvent({ _id: "event-mine", status: "finished" }),
        ]);

        renderPage();

        expect(screen.getByText(/seats filled · open/)).toBeTruthy();
        expect(screen.getByText(/seats filled · finished/)).toBeTruthy();
    });

    it("de-duplicates an event present in BOTH queries (open, and the viewer already joined it)", () => {
        openEventsMock.mockReturnValue([
            makeEvent({ _id: "event-both", status: "open" }),
        ]);
        myEventsMock.mockReturnValue([
            makeEvent({ _id: "event-both", status: "open" }),
        ]);

        renderPage();

        // Exactly one "View" button, not two, for the same event id.
        expect(screen.getAllByText("View")).toHaveLength(1);
    });

    it("sorts the merged list newest-first, regardless of the two source queries' own order (round-2 review finding)", () => {
        // `listOpenLimitedEvents` returns `by_status` index order (ascending
        // creation) and `myLimitedEvents` returns `.order("desc")` — neither
        // matches "newest first" once merged, so Map insertion order alone
        // would render the oldest event first. Three distinct `packSlots`
        // give each event a distinct, orderable name (`limitedEventName`)
        // without depending on `_id`.
        openEventsMock.mockReturnValue([
            makeEvent({
                _id: "event-oldest",
                status: "open",
                seats: [],
                packSlots: ["arn"],
                createdAt: 100,
            }),
        ]);
        myEventsMock.mockReturnValue([
            makeEvent({
                _id: "event-newest",
                status: "started",
                packSlots: ["lea"],
                createdAt: 900,
            }),
            makeEvent({
                _id: "event-middle",
                status: "started",
                packSlots: ["leb"],
                createdAt: 500,
            }),
        ]);

        renderPage();

        const names = screen
            .getAllByText(/Sealed$/)
            .map((el) => el.textContent);
        expect(names).toEqual([
            "Limited Edition Alpha Sealed",
            "Limited Edition Beta Sealed",
            "Arabian Nights Sealed",
        ]);
    });

    it("mine=true narrows to only events the viewer occupies a Seat in", () => {
        openEventsMock.mockReturnValue([
            makeEvent({ _id: "event-open", status: "open", seats: [] }),
        ]);
        myEventsMock.mockReturnValue([
            makeEvent({ _id: "event-mine", status: "started" }),
        ]);

        renderPage({ mine: true });

        expect(
            screen.queryByText(/No Limited Events match this filter\./)
        ).toBe(null);
        expect(screen.getAllByText("View")).toHaveLength(1);
        // The un-seated open event is filtered out.
        expect(screen.queryByText(/0\/2 seats filled · open/)).toBe(null);
    });

    it("status=done narrows to only finished events", () => {
        myEventsMock.mockReturnValue([
            makeEvent({ _id: "event-finished", status: "finished" }),
            makeEvent({ _id: "event-started", status: "started" }),
        ]);
        openEventsMock.mockReturnValue([]);

        renderPage({ status: "done" });

        expect(screen.getAllByText("View")).toHaveLength(1);
        expect(screen.getByText(/finished/i)).toBeTruthy();
    });

    it("shows the filtered-empty message once mine or status narrows the list to nothing", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([]);

        renderPage({ mine: true });

        expect(
            screen.getByText("No Limited Events match this filter.")
        ).toBeTruthy();
    });

    it("shows the plain open-events empty message with no filter active", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([]);

        renderPage();

        expect(
            screen.getByText("No open Limited Events right now.")
        ).toBeTruthy();
    });

    it("navigates to the event detail page when a row's View button is clicked", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([makeEvent({ status: "started" })]);

        renderPage();

        fireEvent.click(screen.getByText("View"));

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
        });
    });

    it("calls onMineChange when the Mine chip is toggled", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([]);
        const onMineChange = vi.fn();

        renderPage({ onMineChange });

        fireEvent.click(screen.getByRole("button", { name: "Mine" }));

        expect(onMineChange).toHaveBeenCalledWith(true);
    });

    it("calls onStatusChange with the chip value when a status chip is pressed", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([]);
        const onStatusChange = vi.fn();

        renderPage({ onStatusChange });

        fireEvent.click(screen.getByRole("button", { name: "Playing" }));

        expect(onStatusChange).toHaveBeenCalledWith("playing");
    });

    it("calls onStatusChange with undefined when the ACTIVE chip is pressed again (back to All)", () => {
        openEventsMock.mockReturnValue([]);
        myEventsMock.mockReturnValue([]);
        const onStatusChange = vi.fn();

        renderPage({ status: "playing", onStatusChange });

        fireEvent.click(screen.getByRole("button", { name: "Playing" }));

        expect(onStatusChange).toHaveBeenCalledWith(undefined);
    });
});
