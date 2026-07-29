// Convex mutation errors reaching the player.
//
// The distinction these tests pin down is PRODUCTION-only and invisible in dev:
// a deployment strips the message of a plain `Error` on its way to the client
// (the whole envelope collapses to "Server Error"), while a `ConvexError`'s
// `data` survives. Legality rejections a player can trip by mis-timing a click
// — a double swipe-to-cast on mobile — throw `ConvexError` for exactly that
// reason, so the extractor must read `data` first.
import { describe, it, expect } from "vitest";
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
