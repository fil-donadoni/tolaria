// Pure pick-timer schedule tests (ADR 0060, issue #1243). Table-driven
// against the official MTGO/Wizards descending schedule, indexed by CARDS
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

    it("returns null for exactly 1 card remaining — no countdown is DISPLAYED, there being no choice to time (issue #2278: that is the display claim only)", () => {
        expect(pickTimerSecondsForCardsRemaining(1)).toBeNull();
    });

    it("returns null for 0 cards remaining (defensive)", () => {
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
        expect(autoPickTimeoutSecondsForCardsRemaining(20)).toBe(40);
    });
});
