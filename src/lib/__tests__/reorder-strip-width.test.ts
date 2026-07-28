import { describe, it, expect } from "vitest";
import {
    fitTileWidth,
    modalChromePaddingX,
    MOBILE_BREAKPOINT_PX,
} from "../reorder-strip-width";

describe("fitTileWidth (issue #1765)", () => {
    // A simple linear strip: N tiles of width `w` plus a fixed gap between
    // them — `stripWidthAt` mirrors TriggerOrderPrompt's own
    // `order.length * (w + GAP) - GAP` formula.
    const linearStripWidthAt =
        (count: number, gap: number) =>
        (w: number): number =>
            count * (w + gap) - gap;

    it("returns the natural width when the strip already fits", () => {
        const stripWidthAt = linearStripWidthAt(3, 20);
        const fitted = fitTileWidth({
            stripWidthAt,
            naturalTileW: 152,
            minTileW: 96,
            availableWidth: 2000,
        });
        expect(fitted).toBe(152);
    });

    it("shrinks the tile width so the strip's footprint matches availableWidth exactly", () => {
        const gap = 20;
        const count = 5;
        const stripWidthAt = linearStripWidthAt(count, gap);
        const availableWidth = 262; // ~390px viewport minus modal chrome
        // minTileW (30) is chosen so its own footprint (230) is BELOW
        // availableWidth (262) — the fit must land strictly between the
        // natural and floor widths, not clamp to the floor.
        const fitted = fitTileWidth({
            stripWidthAt,
            naturalTileW: 152,
            minTileW: 30,
            availableWidth,
        });
        // The fitted width must reproduce the requested footprint exactly
        // (within floating-point tolerance) — this is the affine solve's
        // whole point: no iterative search, an exact inverse.
        expect(stripWidthAt(fitted)).toBeCloseTo(availableWidth, 5);
        expect(fitted).toBeLessThan(152);
        expect(fitted).toBeGreaterThan(30);
    });

    it("never shrinks below minTileW even when the floor itself overflows", () => {
        const stripWidthAt = linearStripWidthAt(5, 20);
        const fitted = fitTileWidth({
            stripWidthAt,
            naturalTileW: 152,
            minTileW: 96,
            // Even 5 tiles at the floor (96) overflow this — the strip must
            // fall back to the floor and let horizontal scroll take over,
            // never shrink further.
            availableWidth: 100,
        });
        expect(fitted).toBe(96);
    });

    it("falls back to the natural width for a non-positive availableWidth (unmeasured/SSR)", () => {
        const stripWidthAt = linearStripWidthAt(5, 20);
        expect(
            fitTileWidth({
                stripWidthAt,
                naturalTileW: 152,
                minTileW: 96,
                availableWidth: 0,
            })
        ).toBe(152);
        expect(
            fitTileWidth({
                stripWidthAt,
                naturalTileW: 152,
                minTileW: 96,
                availableWidth: -50,
            })
        ).toBe(152);
    });

    it("works for a non-trivial affine footprint (fixed intercept, not purely proportional)", () => {
        // A footprint with a WIDTH-INDEPENDENT term (e.g. fixed gaps/library
        // mock offsets that don't scale with the tile width) — the library
        // picker's own `computeLayout` shape. The affine two-point fit must
        // still hit the target exactly even though `footprint(0) !== 0`.
        const stripWidthAt = (w: number) => 2 * w + 340; // intercept = 340
        const fitted = fitTileWidth({
            stripWidthAt,
            naturalTileW: 116,
            minTileW: 72,
            availableWidth: 500,
        });
        expect(stripWidthAt(fitted)).toBeCloseTo(500, 5);
    });

    // Review fix (issue #1765): the chrome padding is now breakpoint-aware —
    // these assert the ACTUAL pixel numbers the Tailwind classes render
    // (`p-2 sm:p-6` on the overlay, `px-0 sm:px-10` on the strip wrapper),
    // not a restatement of `modalChromePaddingX`'s own formula, so a change
    // to either class without a matching change here fails the test.
    it("returns the desktop chrome (p-6 + px-10, both sides) at and above the sm breakpoint", () => {
        expect(modalChromePaddingX(MOBILE_BREAKPOINT_PX)).toBe(128); // (24 + 40) * 2
        expect(modalChromePaddingX(1024)).toBe(128);
    });

    it("returns the shrunk mobile chrome (p-2 + px-0, both sides) below the sm breakpoint", () => {
        expect(modalChromePaddingX(MOBILE_BREAKPOINT_PX - 1)).toBe(16); // (8 + 0) * 2
        expect(modalChromePaddingX(390)).toBe(16);
    });

    // The whole point of shrinking the chrome (not just the tile floor): at
    // 390px a 3-card scry's worst-case footprint (all 3 kept, none bottomed
    // yet — `computeLayout`'s "reserve one card for the empty second zone"
    // shape) must now fit at MIN_CARD_W without falling back to scroll. Under
    // the OLD fixed 128px chrome this never happened for any real scry.
    it("a 3-card scry's floor footprint now fits a 390px viewport (review finding: was previously inert)", () => {
        const MIN_CARD_W = 72;
        const CARD_W_NATURAL = 116;
        // Mirrors `computeLayout(0, 3, true, false, false, w).stripW` for the
        // library-bottom picker's default (nothing dragged yet) 3-card scry.
        const stripWidthAt = (w: number) => 3 * w + 158;
        const availableWidth = 390 - modalChromePaddingX(390);
        const fitted = fitTileWidth({
            stripWidthAt,
            naturalTileW: CARD_W_NATURAL,
            minTileW: MIN_CARD_W,
            availableWidth,
        });
        expect(fitted).toBe(MIN_CARD_W);
        expect(stripWidthAt(fitted)).toBeLessThanOrEqual(availableWidth);
    });
});
