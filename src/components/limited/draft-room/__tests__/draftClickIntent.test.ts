// Issue #5396 (PRD #5384): single vs double click decision on a pack card.
import { describe, it, expect } from "vitest";
import {
    DOUBLE_CLICK_INTERVAL_MS,
    decideClick,
    isFinePointer,
} from "../draftClickIntent";

describe("decideClick", () => {
    it("a first click with a mouse waits for the interval before the menu", () => {
        expect(decideClick("mouse", null)).toBe("open-menu-after-interval");
        expect(decideClick("pen", null)).toBe("open-menu-after-interval");
    });

    it("a second click inside the interval picks, the menu never opens", () => {
        expect(decideClick("mouse", 100)).toBe("pick");
        expect(decideClick("mouse", DOUBLE_CLICK_INTERVAL_MS)).toBe("pick");
    });

    it("a second click after the interval is a fresh single click", () => {
        expect(decideClick("mouse", DOUBLE_CLICK_INTERVAL_MS + 1)).toBe(
            "open-menu-after-interval"
        );
    });

    it("touch, keyboard and unknown pointers keep today's behaviour", () => {
        for (const kind of ["touch", "", undefined]) {
            expect(decideClick(kind, null)).toBe("open-menu");
            expect(decideClick(kind, 50)).toBe("open-menu");
        }
        expect(isFinePointer("touch")).toBe(false);
    });
});
