// Convex mutation errors reaching the player.
//
// The distinction these tests pin down is PRODUCTION-only and invisible in dev:
// a deployment strips the message of a plain `Error` on its way to the client
// (the whole envelope collapses to "Server Error"), while a `ConvexError`'s
// `data` survives. Legality rejections a player can trip by mis-timing a click
// — a double swipe-to-cast on mobile — throw `ConvexError` for exactly that
// reason, so the extractor must read `data` first.
import { describe, it, expect, vi } from "vitest";
import { ConvexError } from "convex/values";
import {
    extractMutationError,
    extractMutationErrorMessage,
} from "../mutation-error";

describe("extractMutationErrorMessage", () => {
    it("unwraps the inner message from a dev envelope", () => {
        const err = new Error(
            "[CONVEX M(game:announceCast)] [Request ID: abc] Server Error\n" +
                "Uncaught Error: Another spell is already being cast\n" +
                "    at handler (../convex/game.ts:6161:18)"
        );
        expect(extractMutationErrorMessage(err)).toBe(
            "Another spell is already being cast"
        );
    });

    it("unwraps a ConvexError envelope too", () => {
        const err = new Error(
            "[CONVEX M(game:announceCast)] [Request ID: abc] Server Error\n" +
                "Uncaught ConvexError: Another spell is already being cast"
        );
        expect(extractMutationErrorMessage(err)).toBe(
            "Another spell is already being cast"
        );
    });

    it("reads a ConvexError's data — the only part production preserves", () => {
        const err = new ConvexError("Another spell is already being cast");
        expect(extractMutationErrorMessage(err)).toBe(
            "Another spell is already being cast"
        );
    });

    it("falls back to a generic message for a non-Error", () => {
        expect(extractMutationErrorMessage("nope")).toBe(
            "Something went wrong"
        );
    });
});

describe("extractMutationError", () => {
    it("titles from the ConvexError data while keeping the full envelope", () => {
        const err = new ConvexError(
            "Illegal action (ADR 0047): the game is waiting for target input, not priority."
        );
        const { title, detail } = extractMutationError(err);
        expect(title).toBe(
            "Illegal action (ADR 0047): the game is waiting for target input, not priority."
        );
        expect(detail.length).toBeGreaterThan(0);
    });

    it("keeps the whole message as detail for a plain Error", () => {
        const message =
            "[CONVEX M(game:activateAbility)] Server Error\nUncaught Error: You don't have priority";
        const { title, detail } = extractMutationError(new Error(message));
        expect(title).toBe("You don't have priority");
        expect(detail).toBe(message);
    });
});

describe("infrastructure failures", () => {
    const TIMEOUT =
        "[CONVEX M(game:announceCast)] [Request ID: abc] Server Error Function execution timed out (maximum duration: 10s)";

    it("maps a timeout to friendly text saying the action was not applied", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const { title, detail } = extractMutationError(new Error(TIMEOUT));
        expect(title).toBe(
            "The server took too long. Your action was not applied — try again."
        );
        expect(detail).toBe(TIMEOUT);
        expect(spy).toHaveBeenCalledWith("[mutation-error]", TIMEOUT);
        spy.mockRestore();
    });

    it("maps a bare production 'Server Error' to friendly text", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        const err = new Error(
            "[CONVEX M(game:x)] [Request ID: abc] Server Error"
        );
        expect(extractMutationError(err).title).toMatch(/not applied/);
        expect(extractMutationErrorMessage(err)).toMatch(/not applied/);
        spy.mockRestore();
    });

    it("maps a network failure to friendly text", () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(
            extractMutationError(new TypeError("Failed to fetch")).title
        ).toMatch(/Could not reach the server.*not applied/);
        spy.mockRestore();
    });

    it("leaves a rule rejection untouched, even one mentioning a timeout", () => {
        const err = new Error(
            "[CONVEX M(game:x)] Server Error\nUncaught Error: Timeout counter cannot be removed"
        );
        expect(extractMutationError(err).title).toBe(
            "Timeout counter cannot be removed"
        );
        expect(
            extractMutationError(new ConvexError("Server Error in rules text"))
                .title
        ).toBe("Server Error in rules text");
    });
});
