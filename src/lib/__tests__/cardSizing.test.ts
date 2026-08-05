// Issue #2056: the responsive card-size clamp must never collapse below a
// legible/tappable floor on a short-and-wide viewport (the `dvh` term binds
// there). `cardBase()` is the single place the floor is applied — every one
// of the four call sites (pool deckbuilder surface, draft pack, draft table
// drag overlay, catalogue deck builder) must route through it rather than
// holding its own un-floored `min(...)` literal.
import { describe, it, expect } from "vitest";
import { CARD_MIN_W, cardBase } from "../cardSizing";

describe("cardSizing — CARD_MIN_W (issue #2056)", () => {
    it("is the recommended 4.5rem floor", () => {
        expect(CARD_MIN_W).toBe("4.5rem");
    });
});

describe("cardBase (issue #2056)", () => {
    it("wraps the min() clamp in a max() floor carrying CARD_MIN_W", () => {
        const result = cardBase("7.5rem", "17vw", "9dvh");
        expect(result).toBe("max(4.5rem, min(7.5rem, 17vw, 9dvh))");
    });

    it("carries the floor for the pool deckbuilder surface's call shape", () => {
        expect(cardBase("7.5rem", "17vw", "9dvh")).toContain(
            `max(${CARD_MIN_W}`
        );
    });

    it("carries the floor for the catalogue deck builder's call shape (different rem/vw/dvh terms)", () => {
        const result = cardBase("8rem", "18vw", "9.5dvh");
        expect(result).toBe("max(4.5rem, min(8rem, 18vw, 9.5dvh))");
    });

    it("never emits a bare min(...) with no surrounding max() floor", () => {
        // Regression shape for the bug itself: a bare `min()` is exactly what
        // let the `dvh` term collapse the tile to 27.3px at 852x303.
        const result = cardBase("7.5rem", "17vw", "9dvh");
        expect(result.startsWith("min(")).toBe(false);
        expect(result).toMatch(/^max\(.*min\(.*\)\)$/);
    });
});
