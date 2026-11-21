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

// Issue #10407 — the real strings, verbatim from the local backend log
// (issue #10116, `docs/research/bot-weak-line-weak-client.md` § 3) and from
// PRODUCTION Sentry events, envelopes included.
describe("isTransientQueryError on the observed server-side shapes (issue #10407)", () => {
    it("classifies the system-operations ceiling as transient", () => {
        expect(
            isTransientQueryError(
                new Error(
                    "[CONVEX Q(game:getPublicState)] [Request ID: 0f3c9a1b2d4e5f60] Server Error\n" +
                        "Your request timed out performing too many system operations."
                )
            )
        ).toBe(true);
        expect(
            isTransientQueryError(
                new Error(
                    "[CONVEX Q(cardPrints:populated)] Your request timed out performing too many system operations."
                )
            )
        ).toBe(true);
    });

    it("classifies the production envelopes of both ceilings as transient", () => {
        // Production keeps a PLATFORM failure's text after "Server Error".
        expect(
            isTransientQueryError(
                new Error(
                    "[CONVEX M(game:forfeitMatch)] [Request ID: ce927eba6d02eca2] Server Error\n" +
                        "Function execution timed out (maximum duration: 1s)\n\n" +
                        "  Called by client"
                )
            )
        ).toBe(true);
        expect(
            isTransientQueryError(
                new Error(
                    "[Request ID: 5d4948855795ddae] Server Error\n" +
                        "Uncaught Error: Your request timed out performing too many system operations.\n" +
                        "    at async signInImpl (signIn.ts:55:25)"
                )
            )
        ).toBe(true);
    });

    it("does NOT classify the production-redacted developer error as transient", () => {
        // A handler's own throw is redacted to a bare "Server Error" in
        // production: that is a genuine function bug, and it must escalate
        // rather than spin.
        expect(
            isTransientQueryError(
                new Error(
                    "[CONVEX M(userDecks:update)] [Request ID: e58f32e5cec5b301] Server Error\n" +
                        "  Called by client"
                )
            )
        ).toBe(false);
        expect(
            isTransientQueryError(
                new Error(
                    "[CONVEX Q(game:getPublicState)] [Request ID: abc123] Server Error\n" +
                        "Uncaught Error: Cannot read properties of undefined (reading 'zones')"
                )
            )
        ).toBe(false);
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
