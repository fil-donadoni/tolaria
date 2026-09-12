// Issue #3266 — which failed Convex query executions are worth running again.
//
// The distinction is the whole retry policy: a message the classifier gets
// wrong in one direction spins forever on a real defect, and in the other
// tears the board down for a 1s ceiling that a second attempt would have
// cleared.
import { describe, it, expect } from "vitest";
import {
    MAX_TRANSIENT_RETRIES,
    isTransientQueryError,
    retryDelayMs,
} from "../transient-query-error";

describe("isTransientQueryError (issue #3266)", () => {
    it("classifies the observed platform-ceiling message as transient", () => {
        // Verbatim shape of what the Convex client hands React, envelope
        // included — this is the message that reached `CatchBoundaryImpl`.
        expect(
            isTransientQueryError(
                new Error(
                    "[CONVEX Q(game:getPublicState)] [Request ID: abc123] Server Error\n" +
                        "Function execution timed out (maximum duration: 1s)"
                )
            )
        ).toBe(true);
    });

    it("classifies transport interruptions as transient", () => {
        expect(isTransientQueryError(new Error("fetch failed"))).toBe(true);
        expect(
            isTransientQueryError(
                new Error("WebSocket closed before the response")
            )
        ).toBe(true);
    });

    it("does NOT classify a developer error as transient", () => {
        // Every retry of this produces the same failure, so it must escalate
        // on the first occurrence rather than make the player wait out a
        // backoff ladder for a verdict that cannot change.
        expect(
            isTransientQueryError(
                new Error(
                    "[CONVEX Q(game:getPublicState)] Uncaught ConvexError: not your game"
                )
            )
        ).toBe(false);
        expect(
            isTransientQueryError(
                new Error(
                    "ArgumentValidationError: Object is missing the field `gameId`"
                )
            )
        ).toBe(false);
    });

    it("does NOT classify an unknown non-Error value as transient", () => {
        // An error nobody can classify escalates, so a new failure mode is
        // SEEN rather than silently retried forever.
        expect(isTransientQueryError("timed out")).toBe(false);
        expect(isTransientQueryError(undefined)).toBe(false);
        expect(isTransientQueryError({ message: "execution timed out" })).toBe(
            false
        );
    });
});

describe("retryDelayMs (issue #3266)", () => {
    it("backs off and then holds at the ceiling", () => {
        expect(retryDelayMs(0)).toBe(250);
        expect(retryDelayMs(1)).toBe(500);
        expect(retryDelayMs(2)).toBe(1000);
        expect(retryDelayMs(3)).toBe(2000);
        // The BUDGET ends the ladder, not a delay growing without bound.
        expect(retryDelayMs(9)).toBe(2000);
    });

    it("spends its whole budget in a few seconds", () => {
        const total = Array.from({ length: MAX_TRANSIENT_RETRIES }, (_, i) =>
            retryDelayMs(i)
        ).reduce((a, b) => a + b, 0);
        expect(total).toBeLessThan(5000);
    });
});
