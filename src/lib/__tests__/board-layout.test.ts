import { describe, it, expect } from "vitest";
import {
    rowLayout,
    fanLayout,
    mirrorVertical,
    reorderIndexForDragX,
    moveItem,
    reconcileHandOrder,
    CARD_WIDTH,
    CARD_HEIGHT,
    type Placement,
} from "../board-layout";

/** Build evenly-spaced slot centers for reorder tests. */
function centers(xs: number[]): Placement[] {
    return xs.map((x) => ({ x, y: 0, rotation: 0, scale: 1 }));
}

const WIDTH = 1200;

/** Leftmost edge of the leftmost card / rightmost edge of the rightmost card,
 *  accounting for scale. Used to assert nothing is clipped off the board. */
function bounds(placements: Placement[], cardWidth = CARD_WIDTH) {
    const left = Math.min(
        ...placements.map((p) => p.x - (cardWidth * p.scale) / 2)
    );
    const right = Math.max(
        ...placements.map((p) => p.x + (cardWidth * p.scale) / 2)
    );
    return { left, right };
}

describe("rowLayout (auto-sizing battlefield row)", () => {
    it("returns no placements for an empty zone", () => {
        expect(rowLayout({ count: 0, width: WIDTH, centerY: 100 })).toEqual([]);
    });

    it("keeps full size and full gap below the overflow threshold", () => {
        const gap = 12;
        const placements = rowLayout({
            count: 3,
            width: WIDTH,
            centerY: 100,
            gap,
        });
        expect(placements).toHaveLength(3);
        // No scaling while it fits.
        expect(placements.every((p) => p.scale === 1)).toBe(true);
        // Step between centers equals card width + full gap (no overlap yet).
        const step = placements[1].x - placements[0].x;
        expect(step).toBeCloseTo(CARD_WIDTH + gap, 5);
    });

    it("shrinks the inter-card step (overlap) once cards overflow the fit width", () => {
        const gap = 12;
        // Pick a count that cannot fit at full step but fits with overlap.
        const fitCount = Math.floor(WIDTH / (CARD_WIDTH + gap));
        const overflowCount = fitCount + 3;

        const fitting = rowLayout({
            count: fitCount,
            width: WIDTH,
            centerY: 0,
            gap,
        });
        const overlapping = rowLayout({
            count: overflowCount,
            width: WIDTH,
            centerY: 0,
            gap,
        });

        const fitStep = fitting[1].x - fitting[0].x;
        const overlapStep = overlapping[1].x - overlapping[0].x;

        // Overlap mode produces a tighter step than the fitting case.
        expect(overlapStep).toBeLessThan(fitStep);
        // Still full scale at this count (overlap absorbs it, no scaling yet).
        expect(overlapping.every((p) => p.scale === 1)).toBe(true);
    });

    it("only scales down at extreme counts, never above the fit threshold", () => {
        const fitCount = Math.floor(WIDTH / (CARD_WIDTH + 12));
        const moderate = rowLayout({
            count: fitCount,
            width: WIDTH,
            centerY: 0,
        });
        const extreme = rowLayout({ count: 60, width: WIDTH, centerY: 0 });

        expect(moderate.every((p) => p.scale === 1)).toBe(true);
        expect(extreme.every((p) => p.scale < 1)).toBe(true);
        // Scale never drops below the documented floor.
        expect(extreme.every((p) => p.scale >= 0.7)).toBe(true);
    });

    it("never places any card off the board, even at extreme counts", () => {
        for (const count of [1, 5, 12, 30, 80]) {
            const placements = rowLayout({ count, width: WIDTH, centerY: 0 });
            const { left, right } = bounds(placements);
            expect(left).toBeGreaterThanOrEqual(-0.5);
            expect(right).toBeLessThanOrEqual(WIDTH + 0.5);
        }
    });

    it("centers the row horizontally", () => {
        const placements = rowLayout({ count: 4, width: WIDTH, centerY: 0 });
        const { left, right } = bounds(placements);
        // Equal margin on both sides → symmetric about the container center.
        expect(left).toBeCloseTo(WIDTH - right, 4);
    });

    it("places all cards on the requested vertical center", () => {
        const placements = rowLayout({ count: 5, width: WIDTH, centerY: 250 });
        expect(placements.every((p) => p.y === 250)).toBe(true);
        expect(placements.every((p) => p.rotation === 0)).toBe(true);
    });
});

describe("fanLayout (shallow fanned hand)", () => {
    it("returns no placements for an empty hand", () => {
        expect(fanLayout({ count: 0, width: WIDTH, baseY: 600 })).toEqual([]);
    });

    it("leaves a single card flat and centered", () => {
        const [card] = fanLayout({ count: 1, width: WIDTH, baseY: 600 });
        expect(card.rotation).toBe(0);
        expect(card.x).toBeCloseTo(WIDTH / 2, 5);
    });

    it("is rotationally symmetric — left edge tilts opposite the right edge", () => {
        const placements = fanLayout({ count: 6, width: WIDTH, baseY: 600 });
        const n = placements.length;
        for (let i = 0; i < Math.floor(n / 2); i++) {
            const leftRot = placements[i].rotation;
            const rightRot = placements[n - 1 - i].rotation;
            expect(leftRot).toBeCloseTo(-rightRot, 5);
        }
    });

    it("rotates cards toward the edges (monotonic increasing rotation)", () => {
        const placements = fanLayout({ count: 7, width: WIDTH, baseY: 600 });
        for (let i = 1; i < placements.length; i++) {
            expect(placements[i].rotation).toBeGreaterThan(
                placements[i - 1].rotation
            );
        }
        // Center card of an odd count is flat.
        expect(placements[3].rotation).toBeCloseTo(0, 5);
    });

    it("lifts the edges into a symmetric dome above the baseline", () => {
        const baseY = 600;
        const placements = fanLayout({ count: 5, width: WIDTH, baseY });
        // Center sits at/near baseline; edges lifted by the same amount.
        expect(placements[2].y).toBeCloseTo(baseY, 5);
        expect(placements[0].y).toBeCloseTo(placements[4].y, 5);
        expect(placements[0].y).toBeGreaterThan(placements[2].y);
    });

    it("keeps every fanned card on the board, even with a large hand", () => {
        const placements = fanLayout({ count: 12, width: WIDTH, baseY: 600 });
        const { left, right } = bounds(placements);
        expect(left).toBeGreaterThanOrEqual(-0.5);
        expect(right).toBeLessThanOrEqual(WIDTH + 0.5);
    });

    it("is horizontally centered", () => {
        const placements = fanLayout({ count: 5, width: WIDTH, baseY: 600 });
        const { left, right } = bounds(placements);
        expect(left).toBeCloseTo(WIDTH - right, 4);
    });
});

describe("reorderIndexForDragX (hand drag-reorder snap, #271 fix 2)", () => {
    // Five slots centered at 100, 200, 300, 400, 500.
    const slots = centers([100, 200, 300, 400, 500]);

    it("keeps the index when the pointer stays over the dragged card's slot", () => {
        expect(reorderIndexForDragX(slots, 2, 305)).toBe(2);
    });

    it("snaps to the slot under the drop position (drag right)", () => {
        // Pointer over slot index 4's center → snaps there.
        expect(reorderIndexForDragX(slots, 0, 495)).toBe(4);
    });

    it("snaps to the slot under the drop position (drag left)", () => {
        expect(reorderIndexForDragX(slots, 4, 105)).toBe(0);
    });

    it("snaps to the NEAREST slot center for an in-between pointer", () => {
        // 260 is closer to slot index 2 (300) than index 1 (200).
        expect(reorderIndexForDragX(slots, 0, 260)).toBe(2);
        // 240 is closer to slot index 1 (200).
        expect(reorderIndexForDragX(slots, 0, 240)).toBe(1);
    });

    it("is a no-op for a single-card hand", () => {
        expect(reorderIndexForDragX(centers([300]), 0, 9999)).toBe(0);
    });

    it("returns the dragged index unchanged when it is out of range", () => {
        expect(reorderIndexForDragX(slots, 9, 300)).toBe(9);
    });
});

describe("moveItem (apply a reorder result, #271 fix 2)", () => {
    it("moves an item forward, shifting the rest", () => {
        expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual([
            "b",
            "c",
            "a",
            "d",
        ]);
    });

    it("moves an item backward", () => {
        expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual([
            "a",
            "d",
            "b",
            "c",
        ]);
    });

    it("returns an unchanged copy for a no-op or out-of-range move", () => {
        const src = ["a", "b", "c"];
        expect(moveItem(src, 1, 1)).toEqual(src);
        expect(moveItem(src, 1, 1)).not.toBe(src);
        expect(moveItem(src, 5, 0)).toEqual(src);
    });

    it("composes with reorderIndexForDragX to settle a card under the drop", () => {
        const order = ["a", "b", "c", "d", "e"];
        const slots = centers([100, 200, 300, 400, 500]);
        // Drag "a" (index 0) to under slot 3's center (400).
        const to = reorderIndexForDragX(slots, 0, 400);
        expect(moveItem(order, 0, to)).toEqual(["b", "c", "d", "a", "e"]);
    });
});

describe("reconcileHandOrder (view-only order vs server hand, #271 fix 2)", () => {
    it("returns the server order verbatim when there is no view permutation", () => {
        expect(reconcileHandOrder([], ["a", "b", "c"])).toEqual([
            "a",
            "b",
            "c",
        ]);
    });

    it("honours the view-only permutation for unchanged ids", () => {
        expect(reconcileHandOrder(["c", "a", "b"], ["a", "b", "c"])).toEqual([
            "c",
            "a",
            "b",
        ]);
    });

    it("appends server-added ids (a draw) after the kept permutation", () => {
        expect(
            reconcileHandOrder(["c", "a", "b"], ["a", "b", "c", "d"])
        ).toEqual(["c", "a", "b", "d"]);
    });

    it("drops server-removed ids (played / discarded)", () => {
        expect(reconcileHandOrder(["c", "a", "b"], ["a", "b"])).toEqual([
            "a",
            "b",
        ]);
    });

    it("handles a simultaneous removal and addition", () => {
        // "a" played, "d" drawn: keep [c,b], append [d].
        expect(reconcileHandOrder(["c", "a", "b"], ["b", "c", "d"])).toEqual([
            "c",
            "b",
            "d",
        ]);
    });
});

describe("mirrorVertical (opponent-side projection)", () => {
    it("flips y about the container height and negates rotation", () => {
        const placement: Placement = {
            x: 300,
            y: 100,
            rotation: 7,
            scale: 1,
        };
        const mirrored = mirrorVertical(placement, 700);
        expect(mirrored.x).toBe(300);
        expect(mirrored.y).toBe(600);
        expect(mirrored.rotation).toBe(-7);
        expect(mirrored.scale).toBe(1);
    });

    it("is its own inverse", () => {
        const placement: Placement = {
            x: 50,
            y: 220,
            rotation: -3,
            scale: 0.8,
        };
        const round = mirrorVertical(mirrorVertical(placement, 700), 700);
        expect(round).toEqual(placement);
    });

    it("keeps the standard card aspect ratio constant", () => {
        expect(CARD_HEIGHT / CARD_WIDTH).toBeCloseTo(7 / 5, 2);
    });
});
