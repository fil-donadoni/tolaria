// Status hint derivation for the lobby dashboard's Limited box (issue
// #1582). Every input field is on the wire `LimitedEventView` — see
// ../limitedEventStatus.ts's doc comment for the projection chain.
import { describe, it, expect } from "vitest";
import {
    isLimitedEventJoinable,
    limitedEventStatusHint,
} from "../limitedEventStatus";
import type { LimitedEventStatus } from "@convex/limited/eventStatus";
import type { LimitedEventSummaryView } from "~/hooks/useLimitedEvent";

function base(
    overrides: Partial<{
        status: LimitedEventStatus;
        type: "sealed" | "draft";
        draftCompletedAt: number | undefined;
        completed: boolean;
    }> = {}
) {
    return {
        status: "started" as const,
        type: "sealed" as const,
        draftCompletedAt: undefined,
        completed: false,
        ...overrides,
    };
}

describe("limitedEventStatusHint (issue #1582)", () => {
    it("returns 'open' while the event is still filling seats", () => {
        expect(limitedEventStatusHint(base({ status: "open" }))).toBe("open");
    });

    it("returns 'open' for a still-open Draft event too", () => {
        expect(
            limitedEventStatusHint(base({ status: "open", type: "draft" }))
        ).toBe("open");
    });

    it("returns 'drafting' for a started Draft whose pool isn't final", () => {
        expect(
            limitedEventStatusHint(
                base({
                    status: "started",
                    type: "draft",
                    draftCompletedAt: undefined,
                })
            )
        ).toBe("drafting");
    });

    it("skips 'drafting' for Sealed — pools are dealt in full at start", () => {
        expect(
            limitedEventStatusHint(
                base({ status: "started", type: "sealed", completed: false })
            )
        ).toBe("deckbuilding");
    });

    it("returns 'deckbuilding' once a Draft's pool is final but not every seat has a deck", () => {
        expect(
            limitedEventStatusHint(
                base({
                    status: "started",
                    type: "draft",
                    draftCompletedAt: 123,
                    completed: false,
                })
            )
        ).toBe("deckbuilding");
    });

    it("returns 'ready to play' once every seat has a deck (Sealed)", () => {
        expect(
            limitedEventStatusHint(
                base({ status: "started", type: "sealed", completed: true })
            )
        ).toBe("ready to play");
    });

    it("returns 'ready to play' once every seat has a deck (Draft)", () => {
        expect(
            limitedEventStatusHint(
                base({
                    status: "started",
                    type: "draft",
                    draftCompletedAt: 123,
                    completed: true,
                })
            )
        ).toBe("ready to play");
    });
});

// Play phase (PRD #1628, ADR 0076, issue #1640). The two new statuses must be
// answered BEFORE the deck/pool-derived fallbacks: a running event is
// `completed` by construction (every seat had a deck before the rounds could
// start), so without an explicit branch it would report "ready to play"
// forever — the exact bug the exhaustive predicate seam exists to prevent.
describe("limitedEventStatusHint — play phase (PRD #1628, issue #1640)", () => {
    it("returns 'playing' while the event's rounds are running", () => {
        expect(
            limitedEventStatusHint(
                base({ status: "playing", type: "draft", draftCompletedAt: 1 })
            )
        ).toBe("playing");
    });

    it("returns 'playing' even though every seat has a deck by then", () => {
        expect(
            limitedEventStatusHint(base({ status: "playing", completed: true }))
        ).toBe("playing");
    });

    it("returns 'finished' once the last round is decided", () => {
        expect(
            limitedEventStatusHint(
                base({ status: "finished", completed: true })
            )
        ).toBe("finished");
    });

    it("never reports a play-phase Draft as 'drafting' (its pool is long final)", () => {
        for (const status of ["playing", "finished"] as const) {
            expect(
                limitedEventStatusHint(
                    base({
                        status,
                        type: "draft",
                        draftCompletedAt: undefined,
                    })
                )
            ).not.toBe("drafting");
        }
    });
});

// The lobby dashboard's "Open Events" narrowing (issue #2648, ADR 0101 §9).
// `isLimitedEventJoinable` is the ONLY definition of "joinable" the dashboard
// uses — these are its ground-truth unit tests, independent of any component.
type EventSeat = LimitedEventSummaryView["seats"][number];

function seat(overrides: Partial<EventSeat> = {}): EventSeat {
    return {
        seatIndex: 0,
        isBot: false,
        isViewer: false,
        poolCount: null,
        hasDeck: false,
        ...overrides,
    };
}

function joinableFixture(
    overrides: Partial<Pick<LimitedEventSummaryView, "status" | "seats">> = {}
): Pick<LimitedEventSummaryView, "status" | "seats"> {
    return {
        status: "open",
        seats: [seat({ seatIndex: 0 }), seat({ seatIndex: 1 })],
        ...overrides,
    };
}

describe("isLimitedEventJoinable (issue #2648)", () => {
    it("accepts an 'open' event with a free Seat and no viewer Seat", () => {
        expect(isLimitedEventJoinable(joinableFixture())).toBe(true);
    });

    it("rejects a non-'open' status (started/playing/finished all close seating)", () => {
        for (const status of ["started", "playing", "finished"] as const) {
            expect(isLimitedEventJoinable(joinableFixture({ status }))).toBe(
                false
            );
        }
    });

    // Trap #1, half 1: the viewer already holds a Seat here — offering Join
    // again duplicates the dashboard's own "Your Current Events" row and the
    // server rejects it ("You already have a seat in this event.").
    it("rejects an event the viewer already holds a Seat in, even with other free Seats", () => {
        expect(
            isLimitedEventJoinable(
                joinableFixture({
                    seats: [
                        seat({
                            seatIndex: 0,
                            userId: "viewer-1",
                            isViewer: true,
                        }),
                        seat({ seatIndex: 1 }),
                    ],
                })
            )
        ).toBe(false);
    });

    // Trap #1, half 2: `status` stays `"open"` until the host explicitly
    // starts the event, so a FULLY seated (human- or Bot-claimed) event can
    // still read `status: "open"` — `status` alone is not sufficient.
    it("rejects a fully-seated 'open' event (every Seat human- or Bot-claimed)", () => {
        expect(
            isLimitedEventJoinable(
                joinableFixture({
                    seats: [
                        seat({ seatIndex: 0, userId: "someone-else" }),
                        seat({ seatIndex: 1, isBot: true }),
                    ],
                })
            )
        ).toBe(false);
    });

    it("accepts an event with a mix of claimed and free Seats", () => {
        expect(
            isLimitedEventJoinable(
                joinableFixture({
                    seats: [
                        seat({ seatIndex: 0, userId: "someone-else" }),
                        seat({ seatIndex: 1 }),
                    ],
                })
            )
        ).toBe(true);
    });
});
