// First-class Limited dashboard box (issue #1582): equal-weight Panel next
// to DashboardPlayBox, Browse/Create action, a quick re-entry list of the
// viewer's CURRENT (in-progress) seated events with a status hint sourced
// from projected fields (`limitedEventStatusHint`, exercised through the
// real event shape here — not a hand-built status string), and (issue
// #2648, ADR 0101 §9 "open events joinable inline") a capped "Open Events"
// list with an inline Join affordance. A concluded event drops off the
// re-entry list; `onViewAllEvents` (issue #2357) is the link to
// `/limited/events`, where it still lives with its final record.
import type { ComponentProps } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";
import DashboardLimitedBox from "../dashboard-limited-box";

afterEach(() => {
    cleanup();
});

function makeEvent(
    overrides: Partial<LimitedEventSummaryView>
): LimitedEventSummaryView {
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "started",
        matchFormat: "bo3",
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

type EventSeat = LimitedEventSummaryView["seats"][number];

function makeSeat(overrides: Partial<EventSeat> = {}): EventSeat {
    return {
        seatIndex: 0,
        isBot: false,
        isViewer: false,
        poolCount: null,
        hasDeck: false,
        ...overrides,
    };
}

/** An "open"-status event with two genuinely FREE seats by default — the
 *  baseline `isLimitedEventJoinable` accepts. Individual tests override
 *  `seats` to build the two must-NOT-join shapes trap #1 warns about: the
 *  viewer already seated, and every seat claimed while `status` stays
 *  `"open"`. */
function makeOpenEvent(
    overrides: Partial<LimitedEventSummaryView> = {}
): LimitedEventSummaryView {
    return {
        _id: "event-open-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "open",
        matchFormat: "bo3",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        packSlots: ["lea"],
        seats: [makeSeat({ seatIndex: 0 }), makeSeat({ seatIndex: 1 })],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

type BoxProps = ComponentProps<typeof DashboardLimitedBox>;

function renderBox(overrides: Partial<BoxProps> = {}) {
    return render(
        <DashboardLimitedBox
            events={[]}
            openEvents={[]}
            onBrowse={vi.fn()}
            onOpen={vi.fn()}
            onJoin={vi.fn()}
            joinPendingEventId={null}
            onViewAllEvents={vi.fn()}
            {...overrides}
        />
    );
}

describe("DashboardLimitedBox (issue #1582)", () => {
    it("renders the Panel header and Browse/Create action even with no seated events", () => {
        renderBox();
        expect(screen.getByText("Limited")).toBeTruthy();
        expect(screen.getByText("Browse / Create Events")).toBeTruthy();
        expect(screen.queryByText("Your Current Events")).toBeNull();
    });

    it("fires onBrowse when the Browse/Create action is clicked", () => {
        const onBrowse = vi.fn();
        renderBox({ onBrowse });
        fireEvent.click(screen.getByText("Browse / Create Events"));
        expect(onBrowse).toHaveBeenCalledTimes(1);
    });

    it("fires onViewAllEvents when 'Your Events (all)' is clicked (issue #2357)", () => {
        const onViewAllEvents = vi.fn();
        renderBox({ onViewAllEvents });
        fireEvent.click(screen.getByText("Your Events (all)"));
        expect(onViewAllEvents).toHaveBeenCalledTimes(1);
    });

    it("lists a seated event with its status hint and opens it on click", () => {
        const onOpen = vi.fn();
        renderBox({
            events: [
                makeEvent({
                    _id: "event-open",
                    status: "open",
                    type: "draft",
                }),
            ],
            onOpen,
        });
        expect(screen.getByText("Your Current Events")).toBeTruthy();
        expect(screen.getByText("open")).toBeTruthy();
        fireEvent.click(screen.getByText("Limited Edition Alpha Draft"));
        expect(onOpen).toHaveBeenCalledWith("event-open");
    });

    it("derives 'drafting' for a started Draft with no final pool yet", () => {
        renderBox({
            events: [
                makeEvent({
                    _id: "event-drafting",
                    status: "started",
                    type: "draft",
                    draftCompletedAt: undefined,
                    completed: false,
                }),
            ],
        });
        expect(screen.getByText("drafting")).toBeTruthy();
    });

    it("derives 'deckbuilding' for a started Sealed event with no deck yet", () => {
        renderBox({
            events: [
                makeEvent({
                    _id: "event-deckbuilding",
                    status: "started",
                    type: "sealed",
                    completed: false,
                }),
            ],
        });
        expect(screen.getByText("deckbuilding")).toBeTruthy();
    });

    it("derives 'ready to play' once the event is completed", () => {
        renderBox({
            events: [
                makeEvent({
                    _id: "event-ready",
                    status: "started",
                    type: "sealed",
                    completed: true,
                }),
            ],
        });
        expect(screen.getByText("ready to play")).toBeTruthy();
    });

    it("lists every seated event, one row each", () => {
        renderBox({
            events: [
                makeEvent({ _id: "event-1", status: "open" }),
                makeEvent({ _id: "event-2", status: "started" }),
            ],
        });
        expect(screen.getAllByText("Limited Edition Alpha Sealed").length).toBe(
            2
        );
    });
});

// Live Limited strip ordering (ADR 0101 §9, issue #2591): the viewer's own
// IN-PROGRESS event sorts first, with a live dot and a primary "Continue"
// CTA — regardless of query order.
describe("DashboardLimitedBox live strip ordering (issue #2591)", () => {
    it("sorts a 'playing' event ahead of an 'open' one even when queried last", () => {
        renderBox({
            events: [
                makeEvent({
                    _id: "event-open",
                    status: "open",
                    type: "draft",
                }),
                makeEvent({
                    _id: "event-playing",
                    status: "playing",
                    type: "sealed",
                    completed: true,
                }),
            ],
        });
        const rows = screen.getAllByRole("button", {
            name: /Limited Edition Alpha/,
        });
        expect(rows[0].textContent).toContain("Sealed");
        expect(rows[1].textContent).toContain("Draft");
    });

    it("renders a live dot and a primary 'Continue' CTA on the top in-progress event only", () => {
        renderBox({
            events: [
                makeEvent({
                    _id: "event-playing",
                    status: "playing",
                    type: "sealed",
                    completed: true,
                }),
                makeEvent({
                    _id: "event-ready",
                    status: "started",
                    type: "draft",
                    completed: true,
                }),
            ],
        });
        const rows = screen.getAllByRole("button", {
            name: /Limited Edition Alpha/,
        });
        expect(rows[0].querySelector("[data-live-dot]")).not.toBeNull();
        expect(rows[0].textContent).toContain("Continue");
        expect(rows[1].querySelector("[data-live-dot]")).toBeNull();
        expect(rows[1].textContent).not.toContain("Continue");
    });

    it("does not show a primary CTA when no event is actually in progress", () => {
        renderBox({
            events: [
                makeEvent({
                    _id: "event-ready",
                    status: "started",
                    type: "draft",
                    completed: true,
                }),
            ],
        });
        expect(screen.queryByText("Continue →")).toBeNull();
        expect(document.querySelector("[data-live-dot]")).toBeNull();
    });
});

// Open events joinable inline (issue #2648, ADR 0101 §9 §9: "open events
// joinable inline"). `openEvents` is the RAW `listOpenLimitedEvents` output —
// every "open"-status event, not just the ones the viewer can actually seat
// into — so the box itself must narrow it, and these tests exercise that
// narrowing rather than assuming the fixture is already narrowed.
describe("DashboardLimitedBox open events (issue #2648)", () => {
    it("renders an 'Open Events' row with a Join action for a genuinely joinable event", () => {
        renderBox({
            openEvents: [makeOpenEvent({ _id: "event-open-1", type: "draft" })],
        });
        expect(screen.getByText("Open Events")).toBeTruthy();
        expect(screen.getByText("Limited Edition Alpha Draft")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
    });

    it("fires onJoin with the event id when Join is clicked", () => {
        const onJoin = vi.fn();
        renderBox({
            openEvents: [makeOpenEvent({ _id: "event-open-1" })],
            onJoin,
        });
        fireEvent.click(screen.getByRole("button", { name: "Join" }));
        expect(onJoin).toHaveBeenCalledWith("event-open-1");
    });

    it("disables the Join button while this event's join is pending", () => {
        renderBox({
            openEvents: [makeOpenEvent({ _id: "event-open-1" })],
            joinPendingEventId: "event-open-1" as Id<"limitedEvents">,
        });
        expect(
            (screen.getByRole("button", { name: "Join" }) as HTMLButtonElement)
                .disabled
        ).toBe(true);
    });

    it("does NOT disable a different event's Join button while another one is pending", () => {
        renderBox({
            openEvents: [
                makeOpenEvent({ _id: "event-open-1" }),
                makeOpenEvent({ _id: "event-open-2" }),
            ],
            joinPendingEventId: "event-open-1" as Id<"limitedEvents">,
        });
        const buttons = screen.getAllByRole("button", {
            name: "Join",
        }) as HTMLButtonElement[];
        expect(buttons[0].disabled).toBe(true);
        expect(buttons[1].disabled).toBe(false);
    });

    // Guard for trap #1 (`listOpenLimitedEvents` includes events the viewer
    // already holds a seat in — the dashboard's OWN "Your Current Events"
    // list already shows those with a "Continue" CTA, so re-offering a Join
    // there would double-list the event and the click would 500 server-side
    // ("You already have a seat…"). Proof-of-failure: deleting the
    // `event.seats.some((seat) => seat.isViewer)` branch from
    // `isLimitedEventJoinable` (src/lib/limitedEventStatus.ts) turns this
    // red — verified by hand per CLAUDE.md § Proof-of-failure, reverted.
    it("excludes an event the viewer already holds a Seat in from the joinable list", () => {
        renderBox({
            openEvents: [
                makeOpenEvent({
                    _id: "event-already-seated",
                    seats: [
                        makeSeat({
                            seatIndex: 0,
                            userId: "viewer-1",
                            isViewer: true,
                        }),
                        makeSeat({ seatIndex: 1 }),
                    ],
                }),
            ],
        });
        expect(screen.queryByText("Open Events")).toBeNull();
        expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
    });

    // Second half of trap #1: an "open"-status event can be FULLY seated
    // (every Seat human- or Bot-claimed) while the host hasn't yet clicked
    // Start — `status` alone under-excludes. Same proof-of-failure
    // discipline as above, on the free-seat branch this time.
    it("excludes a fully-seated 'open' event (no free Seat) from the joinable list", () => {
        renderBox({
            openEvents: [
                makeOpenEvent({
                    _id: "event-full",
                    seats: [
                        makeSeat({ seatIndex: 0, userId: "someone-else" }),
                        makeSeat({ seatIndex: 1, isBot: true }),
                    ],
                }),
            ],
        });
        expect(screen.queryByText("Open Events")).toBeNull();
        expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
    });

    it("caps the joinable list rather than growing unbounded (Browse / Create Events stays the escape hatch)", () => {
        renderBox({
            openEvents: [
                makeOpenEvent({ _id: "event-open-1" }),
                makeOpenEvent({ _id: "event-open-2" }),
                makeOpenEvent({ _id: "event-open-3" }),
                makeOpenEvent({ _id: "event-open-4" }),
            ],
        });
        expect(screen.getAllByRole("button", { name: "Join" }).length).toBe(3);
        expect(screen.getByText("Browse / Create Events")).toBeTruthy();
    });

    it("shows the fallback message when there are neither own nor joinable events", () => {
        renderBox();
        expect(
            screen.getByText(
                "No events in progress — browse open events or create one to get started."
            )
        ).toBeTruthy();
        expect(screen.queryByText("Your Current Events")).toBeNull();
        expect(screen.queryByText("Open Events")).toBeNull();
    });

    it("shows only 'Your Current Events' when the viewer has own events and no joinable ones", () => {
        renderBox({
            events: [makeEvent({ _id: "event-1", status: "started" })],
        });
        expect(screen.getByText("Your Current Events")).toBeTruthy();
        expect(screen.queryByText("Open Events")).toBeNull();
        expect(
            screen.queryByText(
                "No events in progress — browse open events or create one to get started."
            )
        ).toBeNull();
    });

    it("shows only 'Open Events' when there are joinable events and no own events", () => {
        renderBox({
            openEvents: [makeOpenEvent({ _id: "event-open-1" })],
        });
        expect(screen.queryByText("Your Current Events")).toBeNull();
        expect(screen.getByText("Open Events")).toBeTruthy();
        expect(
            screen.queryByText(
                "No events in progress — browse open events or create one to get started."
            )
        ).toBeNull();
    });
});
