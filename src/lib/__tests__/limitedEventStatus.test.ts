// Status hint derivation for the lobby dashboard's Limited box (issue
// #1582). Every input field is on the wire `LimitedEventView` — see
// ../limitedEventStatus.ts's doc comment for the projection chain.
import { describe, it, expect } from "vitest";
import { limitedEventStatusHint } from "../limitedEventStatus";
import type { LimitedEventStatus } from "@convex/limited/eventStatus";

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
            limitedEventStatusHint(base({ status: "finished", completed: true }))
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
