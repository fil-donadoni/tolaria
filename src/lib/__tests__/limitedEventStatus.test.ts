// Status hint derivation for the lobby dashboard's Limited box (issue
// #1582). Every input field is on the wire `LimitedEventView` — see
// ../limitedEventStatus.ts's doc comment for the projection chain.
import { describe, it, expect } from "vitest";
import { limitedEventStatusHint } from "../limitedEventStatus";

function base(
    overrides: Partial<{
        status: "open" | "started";
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
