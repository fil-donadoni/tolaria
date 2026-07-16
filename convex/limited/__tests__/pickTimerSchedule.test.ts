// Pure pick-timer schedule tests (ADR 0060, issue #1243). Table-driven
// against the official MTGO/Wizards descending schedule, indexed by CARDS
// REMAINING in the pack — the seam the per-pick deadline computation
// (`draftEngine.ts`'s `assignFreshPack`) and a sub-15 Booster (ARN/ATQ, 8
// cards) both rely on.
import { describe, it, expect } from "vitest";
import { pickTimerSecondsForCardsRemaining } from "../pickTimerSchedule";

describe("pickTimerSecondsForCardsRemaining (ADR 0060, issue #1243)", () => {
    it.each([
        [15, 40],
        [14, 40],
        [13, 35],
        [12, 30],
        [11, 25],
        [10, 25],
        [9, 20],
        [8, 20],
        [7, 15],
        [6, 10],
        [5, 10],
        [4, 5],
        [3, 5],
        [2, 5],
    ])("cardsRemaining=%i -> %i seconds", (cardsRemaining, expectedSeconds) => {
        expect(pickTimerSecondsForCardsRemaining(cardsRemaining)).toBe(
            expectedSeconds
        );
    });

    it("returns null ('auto') for exactly 1 card remaining — no real choice to time", () => {
        expect(pickTimerSecondsForCardsRemaining(1)).toBeNull();
    });

    it("returns null ('auto') for 0 cards remaining (defensive)", () => {
        expect(pickTimerSecondsForCardsRemaining(0)).toBeNull();
    });

    it("a sub-15 pack (ARN/ATQ = 8 cards) starts lower on the SAME table, not a separate schedule", () => {
        // The very first pick of an 8-card pack has 8 cards remaining —
        // indexing the same table gives 20s, exactly like the 8th pick of a
        // full 15-card Booster would.
        expect(pickTimerSecondsForCardsRemaining(8)).toBe(20);
    });

    it("clamps a larger-than-15 pack to the top of the schedule (defensive)", () => {
        expect(pickTimerSecondsForCardsRemaining(20)).toBe(40);
    });
});
