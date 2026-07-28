import { describe, it, expect } from "vitest";
import { fitTileWidth, MODAL_CHROME_PADDING_X } from "../reorder-strip-width";

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

    it("MODAL_CHROME_PADDING_X matches the shared modal's fixed p-6 + px-10 chrome", () => {
        // p-6 (24px * 2) + px-10 (40px * 2) — both LibraryOrderPicker and
        // TriggerOrderPrompt wrap the strip in this exact chrome.
        expect(MODAL_CHROME_PADDING_X).toBe(24 * 2 + 40 * 2);
    });
});
