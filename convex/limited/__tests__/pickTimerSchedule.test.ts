// Pure pick-timer schedule tests (ADR 0060, issue #1243). Table-driven
// against the Arena-like descending schedule (issue #9149), indexed by CARDS
// REMAINING in the pack — the seam the per-pick deadline computation
// (`draftEngine.ts`'s `assignFreshPack`) and a sub-15 Booster (ARN/ATQ, 8
// cards) both rely on.
import { describe, it, expect } from "vitest";
import {
    AUTO_PICK_FLOOR_SECONDS,
    autoPickTimeoutSecondsForCardsRemaining,
    pickTimerSecondsForCardsRemaining,
} from "../pickTimerSchedule";

describe("pickTimerSecondsForCardsRemaining (ADR 0060, issue #1243)", () => {
    it.each([
        [15, 75],
        [14, 70],
        [13, 65],
        [12, 60],
        [11, 55],
        [10, 50],
        [9, 45],
        [8, 40],
        [7, 35],
        [6, 30],
        [5, 30],
        [4, 30],
        [3, 30],
        [2, 30],
    ])("cardsRemaining=%i -> %i seconds", (cardsRemaining, expectedSeconds) => {
        expect(pickTimerSecondsForCardsRemaining(cardsRemaining)).toBe(
            expectedSeconds
        );
    });

    it("returns null for exactly 1 card remaining — no countdown is DISPLAYED, there being no choice to time (issue #2278: that is the display claim only)", () => {
        expect(pickTimerSecondsForCardsRemaining(1)).toBeNull();
    });

    it("never goes below the 30 s floor for any scheduled pack size", () => {
        for (let n = 2; n <= 15; n++) {
            expect(pickTimerSecondsForCardsRemaining(n)).toBeGreaterThanOrEqual(
                30
            );
        }
    });

    it("returns null for 0 cards remaining (defensive)", () => {
        expect(pickTimerSecondsForCardsRemaining(0)).toBeNull();
    });

    it("a sub-15 pack (ARN/ATQ = 8 cards) starts lower on the SAME table, not a separate schedule", () => {
        // The very first pick of an 8-card pack has 8 cards remaining —
        // indexing the same table gives 40s, exactly like the 8th pick of a
        // full 15-card Booster would.
        expect(pickTimerSecondsForCardsRemaining(8)).toBe(40);
    });

    it("clamps a larger-than-15 pack to the top of the schedule (defensive)", () => {
        expect(pickTimerSecondsForCardsRemaining(20)).toBe(75);
    });
});

describe("autoPickTimeoutSecondsForCardsRemaining (issue #2278)", () => {
    it.each([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2])(
        "cardsRemaining=%i matches the displayed countdown exactly — the two only diverge at 1",
        (cardsRemaining) => {
            expect(
                autoPickTimeoutSecondsForCardsRemaining(cardsRemaining)
            ).toBe(pickTimerSecondsForCardsRemaining(cardsRemaining));
        }
    );

    it("schedules the floor for exactly 1 card remaining, where nothing is displayed — an absent Seat must not strand the table on the last card of a pack", () => {
        expect(pickTimerSecondsForCardsRemaining(1)).toBeNull();
        expect(autoPickTimeoutSecondsForCardsRemaining(1)).toBe(
            AUTO_PICK_FLOOR_SECONDS
        );
    });

    it("schedules nothing at 0 cards remaining — the defensive case has nothing to pick", () => {
        expect(autoPickTimeoutSecondsForCardsRemaining(0)).toBeNull();
        expect(autoPickTimeoutSecondsForCardsRemaining(-1)).toBeNull();
    });

    it("clamps a larger-than-15 pack to the top of the schedule, like the display half", () => {
        expect(autoPickTimeoutSecondsForCardsRemaining(20)).toBe(75);
    });
});
