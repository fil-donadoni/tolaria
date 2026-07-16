// Event completion (issue #1116 AC: "Event reaches a completed state exactly
// when every seat has a deck"). Pure unit tests against
// `computeEventCompletion` — no convex-test harness needed (project
// convention).
import { describe, it, expect } from "vitest";
import {
    computeEventCompletion,
    type CompletionSeatLookup,
} from "../completion";
import type { AutoBuildEventContext } from "../autoBuild";

const sealedStarted: AutoBuildEventContext = {
    type: "sealed",
    status: "started",
};
const sealedOpen: AutoBuildEventContext = { type: "sealed", status: "open" };
const draftInProgress: AutoBuildEventContext = {
    type: "draft",
    status: "started",
};
const draftDone: AutoBuildEventContext = {
    type: "draft",
    status: "started",
    draftCompletedAt: 123,
};

describe("computeEventCompletion (issue #1116)", () => {
    it("is not completed while the event is still open (pool never final)", () => {
        const seats: CompletionSeatLookup[] = [
            { seatIndex: 0 },
            { seatIndex: 1, isBot: true },
        ];
        const result = computeEventCompletion(seats, sealedOpen, () => true);
        expect(result.completed).toBe(false);
        expect(result.seatsWithDeck).toBe(0);
        expect(result.seatsTotal).toBe(2);
    });

    it("is not completed while a Draft's picks are still in progress, even if every human already has a deck", () => {
        const seats: CompletionSeatLookup[] = [
            { seatIndex: 0 },
            { seatIndex: 1, isBot: true },
        ];
        const result = computeEventCompletion(
            seats,
            draftInProgress,
            () => true
        );
        expect(result.completed).toBe(false);
    });

    it("a Sealed event completes the instant every seat has a deck (bots free, humans via hasHumanDeck)", () => {
        const seats: CompletionSeatLookup[] = [
            { seatIndex: 0 },
            { seatIndex: 1 },
            { seatIndex: 2, isBot: true },
        ];
        // Both humans submitted.
        const bothHuman = computeEventCompletion(
            seats,
            sealedStarted,
            () => true
        );
        expect(bothHuman.completed).toBe(true);
        expect(bothHuman.seatsWithDeck).toBe(3);
        expect(bothHuman.seatsTotal).toBe(3);

        // Only seat 0 submitted — NOT complete.
        const oneHuman = computeEventCompletion(
            seats,
            sealedStarted,
            (seatIndex) => seatIndex === 0
        );
        expect(oneHuman.completed).toBe(false);
        expect(oneHuman.seatsWithDeck).toBe(2); // seat 0 (human) + seat 2 (bot)
    });

    it("a bot seat NEVER counts before the Pool is final, even if hasHumanDeck were (incorrectly) asked about it", () => {
        const seats: CompletionSeatLookup[] = [{ seatIndex: 0, isBot: true }];
        const result = computeEventCompletion(seats, sealedOpen, () => true);
        expect(result.completed).toBe(false);
        expect(result.seatsWithDeck).toBe(0);
    });

    it("hasHumanDeck is never consulted for a bot seat", () => {
        const seats: CompletionSeatLookup[] = [{ seatIndex: 0, isBot: true }];
        const result = computeEventCompletion(seats, sealedStarted, () => {
            throw new Error("hasHumanDeck should never be called for a bot");
        });
        expect(result.completed).toBe(true);
    });

    it("a Draft completes once picks finish AND every seat has a deck", () => {
        const seats: CompletionSeatLookup[] = [
            { seatIndex: 0 },
            { seatIndex: 1, isBot: true },
        ];
        expect(
            computeEventCompletion(seats, draftDone, () => true).completed
        ).toBe(true);
        expect(
            computeEventCompletion(seats, draftDone, () => false).completed
        ).toBe(false);
    });

    it("an event with zero seats is never completed (never vacuously true)", () => {
        const result = computeEventCompletion([], sealedStarted, () => true);
        expect(result.completed).toBe(false);
        expect(result.seatsTotal).toBe(0);
    });

    it("an all-bot event completes with zero human involvement", () => {
        const seats: CompletionSeatLookup[] = [
            { seatIndex: 0, isBot: true },
            { seatIndex: 1, isBot: true },
        ];
        const result = computeEventCompletion(seats, sealedStarted, () => {
            throw new Error("no human seats exist here");
        });
        expect(result.completed).toBe(true);
        expect(result.seatsWithDeck).toBe(2);
    });
});
