import { describe, it, expect } from "vitest";
import { computeGridWindow, type GridMetrics } from "../gridWindow";

// A 10-column grid of 100px rows, viewport 300px tall (3 rows visible), grid
// starting 40px down the scroll container (the sticky "N cards found" bar).
function metrics(over: Partial<GridMetrics> = {}): GridMetrics {
    return {
        count: 500,
        columns: 10,
        rowHeight: 100,
        gridTop: 40,
        scrollTop: 0,
        viewportHeight: 300,
        overscanRows: 2,
        ...over,
    };
}

const SEED = 40;

describe("computeGridWindow", () => {
    it("reserves the full match set's height, not the mounted rows'", () => {
        // 500 cards / 10 columns = 50 rows of 100px. The scrollbar has to
        // describe the whole set or the user cannot reach the end.
        expect(computeGridWindow(metrics(), SEED).totalHeight).toBe(5000);
    });

    it("rounds a partial last row up", () => {
        expect(
            computeGridWindow(metrics({ count: 501 }), SEED).totalHeight
        ).toBe(5100);
    });

    it("mounts only the visible rows plus overscan", () => {
        const win = computeGridWindow(metrics(), SEED);
        // At the top: rows 0..2 visible, +2 overscan below, none above.
        expect(win.start).toBe(0);
        expect(win.end).toBe(50); // rows 0-4 × 10 columns
        expect(win.offsetTop).toBe(0);
    });

    it("bounds the mounted count no matter how large the match set", () => {
        const small = computeGridWindow(metrics({ count: 500 }), SEED);
        const huge = computeGridWindow(metrics({ count: 500_000 }), SEED);
        expect(huge.end - huge.start).toBe(small.end - small.start);
    });

    it("slides the window and its offset as the user scrolls", () => {
        // scrollTop 1040 with gridTop 40 → 1000px into the grid → row 10.
        const win = computeGridWindow(metrics({ scrollTop: 1040 }), SEED);
        expect(win.start).toBe(80); // (10 - 2 overscan) × 10 columns
        expect(win.end).toBe(160); // (13 + 1 + 2 overscan) × 10 columns
        // The mounted block must be positioned at the row it actually
        // represents — otherwise the cards render at the top of the spacer and
        // the grid appears empty wherever the user has scrolled to.
        expect(win.offsetTop).toBe(800);
    });

    it("never starts before the first row", () => {
        // Scrolled just past the grid's top edge: overscan would go negative.
        const win = computeGridWindow(metrics({ scrollTop: 90 }), SEED);
        expect(win.start).toBe(0);
        expect(win.offsetTop).toBe(0);
    });

    it("clamps the last window to the match set", () => {
        const win = computeGridWindow(
            metrics({ count: 55, scrollTop: 10_000 }),
            SEED
        );
        expect(win.end).toBe(55);
        // Non-empty: the last row stays mounted rather than collapsing to an
        // empty slice.
        expect(win.start).toBeLessThan(win.end);
    });

    it("renders a seed slice while the geometry is still unmeasured", () => {
        // Before the first cell exists there is no cell width or height to
        // read, so guessing a row pitch would place the window at a random
        // offset. Render a screenful in normal flow instead (totalHeight 0 is
        // the caller's signal not to switch on the spacer).
        const win = computeGridWindow(
            metrics({ columns: 0, rowHeight: 0 }),
            SEED
        );
        expect(win).toEqual({
            start: 0,
            end: SEED,
            offsetTop: 0,
            totalHeight: 0,
        });
    });

    it("returns an empty window for an empty match set", () => {
        const win = computeGridWindow(metrics({ count: 0 }), SEED);
        expect(win).toEqual({
            start: 0,
            end: 0,
            offsetTop: 0,
            totalHeight: 0,
        });
    });
});
