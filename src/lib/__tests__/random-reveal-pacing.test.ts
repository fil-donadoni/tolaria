// Issue #5519 — the shared pacing table of a Random Reveal (CR 705.2): tosses
// shorten ×0.7 per round down to 650 ms, holds shrink 120 ms per round down to
// 650 ms, and a sequence ends on a 1400 ms final hold.
import { describe, expect, it } from "vitest";
import {
    FLIP_ANIM_MS,
    REVEAL_FINAL_HOLD_MS,
    holdMs,
    sequenceDurationMs,
    tossMs,
} from "~/lib/random-reveal-pacing";

describe("random-reveal pacing table", () => {
    it("tosses decay ×0.7 from the first toss down to the 650 ms floor", () => {
        expect(tossMs(0)).toBe(FLIP_ANIM_MS);
        expect(tossMs(1)).toBe(1120);
        expect(tossMs(2)).toBe(784);
        expect(tossMs(3)).toBe(650);
        expect(tossMs(20)).toBe(650);
    });

    it("holds shrink 120 ms per round down to the 650 ms floor", () => {
        expect(holdMs(0)).toBe(1100);
        expect(holdMs(1)).toBe(980);
        expect(holdMs(3)).toBe(740);
        expect(holdMs(4)).toBe(650);
        expect(holdMs(30)).toBe(650);
    });

    it("a sequence is every toss, the holds between them, and the final hold", () => {
        expect(sequenceDurationMs(1)).toBe(tossMs(0) + REVEAL_FINAL_HOLD_MS);
        expect(sequenceDurationMs(3)).toBe(
            tossMs(0) +
                holdMs(0) +
                tossMs(1) +
                holdMs(1) +
                tossMs(2) +
                REVEAL_FINAL_HOLD_MS
        );
        expect(REVEAL_FINAL_HOLD_MS).toBe(1400);
    });
});
