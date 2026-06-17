import { describe, it, expect } from "vitest";
import {
    rowLayout,
    fanLayout,
    mirrorVertical,
    CARD_WIDTH,
    CARD_HEIGHT,
    type Placement,
} from "../board-layout";

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
