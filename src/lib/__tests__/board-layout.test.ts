import { describe, it, expect } from "vitest";
import {
    rowLayout,
    bandedRowsLayout,
    splitRowLayout,
    fanLayout,
    mirrorVertical,
    reorderIndexForDragX,
    clampDragOffsetX,
    handGapPlacements,
    moveItem,
    reconcileHandOrder,
    stackFanOffset,
    isDepthPile,
    stackDepthOffset,
    STACK_DEPTH_PILE_THRESHOLD,
    STACK_DEPTH_OFFSET,
    STACK_DEPTH_MAX_VISIBLE_EDGES,
    STACK_FAN_REVEAL,
    STACK_FAN_MAX_WIDTH,
    CARD_WIDTH,
    CARD_HEIGHT,
    RIGHT_GUTTER,
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

describe("rowLayout maxScale cap (band-height fit)", () => {
    it("caps the row scale below the horizontal-fit scale", () => {
        // A small count would otherwise place at scale 1; the cap forces it down
        // so the row fits a limited band height.
        const placed = rowLayout({
            count: 2,
            width: WIDTH,
            centerY: 50,
            maxScale: 0.5,
        });
        expect(placed.every((p) => p.scale === 0.5)).toBe(true);
    });

    it("the cap wins even below the readability floor (no vertical clip)", () => {
        const placed = rowLayout({
            count: 10,
            width: 300, // forces horizontal shrink toward MIN_SCALE (0.7)
            centerY: 50,
            maxScale: 0.4,
        });
        expect(placed.every((p) => p.scale <= 0.4 + 1e-9)).toBe(true);
    });
});

describe("splitRowLayout (two-block back row: lands left, others right)", () => {
    it("clusters the left block flush-left and the right block flush-right", () => {
        const placed = splitRowLayout({
            left: 2,
            right: 2,
            width: WIDTH,
            centerY: 0,
        });
        expect(placed).toHaveLength(4);
        const half = CARD_WIDTH / 2;
        expect(placed[0].x).toBeCloseTo(half, 4);
        expect(placed[3].x).toBeCloseTo(WIDTH - half, 4);
        // A gap separates the two blocks.
        expect(placed[1].x).toBeLessThan(placed[2].x);
    });

    it("centers the present block when the other is empty", () => {
        const onlyLands = splitRowLayout({
            left: 3,
            right: 0,
            width: WIDTH,
            centerY: 0,
        });
        const centered = rowLayout({ count: 3, width: WIDTH, centerY: 0 });
        expect(onlyLands.map((p) => p.x)).toEqual(centered.map((p) => p.x));
    });

    it("falls back to a single centered packed row when the blocks collide", () => {
        const placed = splitRowLayout({
            left: 20,
            right: 20,
            width: WIDTH,
            centerY: 0,
        });
        const centered = rowLayout({ count: 40, width: WIDTH, centerY: 0 });
        expect(placed.map((p) => p.x)).toEqual(centered.map((p) => p.x));
    });

    it("returns nothing for an empty row", () => {
        expect(
            splitRowLayout({ left: 0, right: 0, width: WIDTH, centerY: 0 })
        ).toEqual([]);
    });
});

describe("bandedRowsLayout (creatures row over a split back row)", () => {
    const WIDTH_BF = 1000;
    const HEIGHT_BF = 360;

    it("places a count band over a split band at their centerY fractions", () => {
        const placed = bandedRowsLayout({
            bands: [
                { count: 2, centerYFrac: 0.28 }, // creatures
                { split: { left: 2, right: 1 }, centerYFrac: 0.74 }, // back
            ],
            width: WIDTH_BF,
            height: HEIGHT_BF,
        });
        expect(placed).toHaveLength(5);
        expect(placed.slice(0, 2).every((p) => p.y === HEIGHT_BF * 0.28)).toBe(
            true
        );
        expect(placed.slice(2).every((p) => p.y === HEIGHT_BF * 0.74)).toBe(
            true
        );
        // Back-row lands flush-left, the single other flush-right.
        const half = CARD_WIDTH * placed[2].scale * 0.5;
        expect(placed[2].x).toBeCloseTo(half, 4);
        expect(placed[4].x).toBeCloseTo(WIDTH_BF - half, 4);
    });

    it("caps every card so a full-height card fits its band slice (no clip)", () => {
        const placed = bandedRowsLayout({
            bands: [
                { count: 1, centerYFrac: 0.28 },
                { split: { left: 1, right: 1 }, centerYFrac: 0.74 },
            ],
            width: WIDTH_BF,
            height: HEIGHT_BF,
        });
        const bandHeight = HEIGHT_BF / 2;
        expect(placed.every((p) => CARD_HEIGHT * p.scale <= bandHeight)).toBe(
            true
        );
    });

    it("returns nothing for an empty board", () => {
        expect(
            bandedRowsLayout({
                bands: [
                    { count: 0, centerYFrac: 0.28 },
                    { split: { left: 0, right: 0 }, centerYFrac: 0.74 },
                ],
                width: WIDTH_BF,
                height: HEIGHT_BF,
            })
        ).toEqual([]);
    });
});

describe("bandedRowsLayout right gutter (#334 — control-column symmetry)", () => {
    const WIDTH_BF = 1000;
    const HEIGHT_BF = 360;

    // The flush-right back-row block must end before the reserved control
    // column. With a gutter, the rightmost noncreature's FAR edge lands at
    // `width - RIGHT_GUTTER`, never under the pod.
    function rightEdge(placement: Placement): number {
        return placement.x + (CARD_WIDTH * placement.scale) / 2;
    }

    it("ends the flush-right back-row block at width - RIGHT_GUTTER", () => {
        const placed = bandedRowsLayout({
            bands: [
                { count: 1, centerYFrac: 0.28 }, // creature
                { split: { left: 2, right: 2 }, centerYFrac: 0.74 }, // back row
            ],
            width: WIDTH_BF,
            height: HEIGHT_BF,
            rightGutter: RIGHT_GUTTER,
        });
        // Rightmost placement is the last flush-right noncreature.
        const last = placed[placed.length - 1];
        expect(rightEdge(last)).toBeCloseTo(WIDTH_BF - RIGHT_GUTTER, 3);
    });

    it("reserves the SAME right boundary on both seats (symmetry)", () => {
        // Both seats call the identical layout fn (the opponent only mirrors Y,
        // which leaves x / scale untouched), so the reserved right boundary is
        // shared. Assert two independent computations with the same gutter agree.
        const bands = [
            { count: 2, centerYFrac: 0.28 },
            { split: { left: 3, right: 2 }, centerYFrac: 0.74 },
        ];
        const viewer = bandedRowsLayout({
            bands,
            width: WIDTH_BF,
            height: HEIGHT_BF,
            rightGutter: RIGHT_GUTTER,
        });
        const opponent = bandedRowsLayout({
            bands,
            width: WIDTH_BF,
            height: HEIGHT_BF,
            rightGutter: RIGHT_GUTTER,
        });
        const viewerRight = Math.max(...viewer.map(rightEdge));
        const opponentRight = Math.max(...opponent.map(rightEdge));
        expect(viewerRight).toBeCloseTo(opponentRight, 6);
        expect(viewerRight).toBeCloseTo(WIDTH_BF - RIGHT_GUTTER, 3);
    });

    it("keeps every card left of the reserved column (nothing under the pod)", () => {
        const placed = bandedRowsLayout({
            bands: [
                { count: 4, centerYFrac: 0.28 },
                { split: { left: 3, right: 3 }, centerYFrac: 0.74 },
            ],
            width: WIDTH_BF,
            height: HEIGHT_BF,
            rightGutter: RIGHT_GUTTER,
        });
        for (const p of placed) {
            expect(rightEdge(p)).toBeLessThanOrEqual(
                WIDTH_BF - RIGHT_GUTTER + 0.5
            );
        }
    });

    it("defaults to the full width when no gutter is reserved", () => {
        const placed = bandedRowsLayout({
            bands: [{ split: { left: 1, right: 1 }, centerYFrac: 0.74 }],
            width: WIDTH_BF,
            height: HEIGHT_BF,
        });
        const last = placed[placed.length - 1];
        expect(rightEdge(last)).toBeCloseTo(WIDTH_BF, 3);
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

describe("clampDragOffsetX (bound the dragged-card lift to the hand span)", () => {
    // Five slots centered at 100, 200, 300, 400, 500.
    const slots = centers([100, 200, 300, 400, 500]);

    it("passes a small in-span offset through unchanged", () => {
        // Card at slot 2 (center 300) nudged +80 → center 380, still in [100,500].
        expect(clampDragOffsetX(slots, 2, 80)).toBe(80);
        expect(clampDragOffsetX(slots, 2, -80)).toBe(-80);
    });

    it("pins the leftmost card at the first slot (can't go past it)", () => {
        // Card at slot 0 (center 100) dragged far left: rendered center clamped
        // to 100 → offset clamped to 0.
        expect(clampDragOffsetX(slots, 0, -999)).toBe(0);
    });

    it("pins the rightmost card at the last slot (can't go past it)", () => {
        // Card at slot 4 (center 500) dragged far right → offset clamped to 0.
        expect(clampDragOffsetX(slots, 4, 999)).toBe(0);
    });

    it("clamps a mid-hand card to reach exactly the first / last slot", () => {
        // Card at slot 2 (center 300): may travel down to 100 (dx -200) and up to
        // 500 (dx +200), no further.
        expect(clampDragOffsetX(slots, 2, -999)).toBe(-200);
        expect(clampDragOffsetX(slots, 2, 999)).toBe(200);
    });

    it("is a no-op for a single-card hand (span is a point)", () => {
        expect(clampDragOffsetX(centers([300]), 0, 999)).toBe(0);
        expect(clampDragOffsetX(centers([300]), 0, -999)).toBe(0);
    });

    it("returns the raw offset when the dragged index is out of range", () => {
        expect(clampDragOffsetX(slots, 9, 123)).toBe(123);
        expect(clampDragOffsetX([], 0, 123)).toBe(123);
    });
});

describe("handGapPlacements (deferred-commit drag gap, drag-reorder v2)", () => {
    // Distinct, easily-identified fan slots.
    const fan = centers([100, 200, 300, 400, 500]);

    it("parks the dragged card on the drop slot", () => {
        // Drag index 0 to drop slot 3.
        const res = handGapPlacements(fan, 0, 3);
        expect(res[0].x).toBe(fan[3].x);
    });

    it("shifts the run between source and target to open the gap (drag right)", () => {
        // from=0 → dropIndex=4: others fill slots 0..3, dragged takes slot 4.
        const res = handGapPlacements(fan, 0, 4).map((p) => p.x);
        expect(res).toEqual([500, 100, 200, 300, 400]);
    });

    it("shifts the run the other way (drag left)", () => {
        // from=4 → dropIndex=1: slots 1..3 shift right, dragged takes slot 1.
        const res = handGapPlacements(fan, 4, 1).map((p) => p.x);
        expect(res).toEqual([100, 300, 400, 500, 200]);
    });

    it("is the identity when the drop slot equals the source slot", () => {
        const res = handGapPlacements(fan, 2, 2).map((p) => p.x);
        expect(res).toEqual([100, 200, 300, 400, 500]);
    });

    it("matches the post-commit fan exactly, so the drop is seamless", () => {
        // The visual gap layout during the drag must equal what the plain fan
        // produces AFTER moveItem commits — otherwise the card jumps on release.
        const order = ["a", "b", "c", "d", "e"];
        const from = 0;
        const dropIndex = 3;
        const gap = handGapPlacements(fan, from, dropIndex);
        const committed = moveItem(order, from, dropIndex);
        // After commit, card i sits on fan slot i. The dragged card ("a") is now
        // at committed index `dropIndex`; assert its slot matches the gap layout.
        const committedDraggedIndex = committed.indexOf("a");
        expect(gap[from].x).toBe(fan[committedDraggedIndex].x);
        // And every other card's gap slot equals its committed fan slot.
        for (let i = 0; i < order.length; i++) {
            if (i === from) continue;
            const committedIndex = committed.indexOf(order[i]);
            expect(gap[i].x).toBe(fan[committedIndex].x);
        }
    });

    it("returns an unchanged copy for out-of-range indices", () => {
        expect(handGapPlacements(fan, 9, 1)).toEqual(fan);
        expect(handGapPlacements(fan, 1, 9)).toEqual(fan);
        expect(handGapPlacements(fan, 1, 9)).not.toBe(fan);
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

describe("stackFanOffset — fanned permanent stack reveal (PRD #621, #623)", () => {
    it("returns 0 for a single member (no fan)", () => {
        expect(stackFanOffset(1)).toBe(0);
        expect(stackFanOffset(0)).toBe(0);
    });

    it("uses the full resting reveal when the fan fits under the max width", () => {
        // 2 members: total width = 120 + 34 = 154 < 360, so no clamp.
        expect(stackFanOffset(2)).toBe(STACK_FAN_REVEAL);
        // 3 members: 120 + 2*34 = 188 < 360, still no clamp.
        expect(stackFanOffset(3)).toBe(STACK_FAN_REVEAL);
    });

    it("clamps the offset so the fan never exceeds the max width", () => {
        // 8 members at full reveal would be 120 + 7*34 = 358 ≤ 360 (still fits).
        expect(stackFanOffset(8)).toBe(STACK_FAN_REVEAL);
        // A larger count is clamped: offset = (360 - 120) / (n - 1).
        const offset = stackFanOffset(20);
        expect(offset).toBeLessThan(STACK_FAN_REVEAL);
        expect(offset).toBeCloseTo((STACK_FAN_MAX_WIDTH - CARD_WIDTH) / 19, 5);
    });

    it("keeps the total fan width at or under the cap for every size 2..8", () => {
        for (let n = 2; n <= 8; n++) {
            const total = CARD_WIDTH + (n - 1) * stackFanOffset(n);
            expect(total).toBeLessThanOrEqual(STACK_FAN_MAX_WIDTH + 0.001);
        }
    });
});

describe("isDepthPile — large permanent stack threshold (PRD #621, #624)", () => {
    it("is false at and below the threshold (these still fan)", () => {
        for (let n = 0; n <= STACK_DEPTH_PILE_THRESHOLD; n++) {
            expect(isDepthPile(n)).toBe(false);
        }
    });

    it("is true strictly above the threshold", () => {
        expect(isDepthPile(STACK_DEPTH_PILE_THRESHOLD + 1)).toBe(true);
        expect(isDepthPile(50)).toBe(true);
    });
});

describe("stackDepthOffset — depth-pile diagonal step (PRD #621, #624)", () => {
    it("starts at 0 for the bottom face and steps by the fixed offset", () => {
        expect(stackDepthOffset(0)).toBe(0);
        expect(stackDepthOffset(1)).toBe(STACK_DEPTH_OFFSET);
        expect(stackDepthOffset(3)).toBe(3 * STACK_DEPTH_OFFSET);
    });

    it("clamps the spread so the pile keeps a ~one-card footprint", () => {
        // Beyond the visible-edge cap the offset stops growing — deeper faces
        // share the maximal offset, so a huge stack never spreads past a card.
        const max = STACK_DEPTH_MAX_VISIBLE_EDGES * STACK_DEPTH_OFFSET;
        expect(stackDepthOffset(STACK_DEPTH_MAX_VISIBLE_EDGES)).toBe(max);
        expect(stackDepthOffset(STACK_DEPTH_MAX_VISIBLE_EDGES + 5)).toBe(max);
        expect(stackDepthOffset(100)).toBe(max);
        // The capped spread plus one card stays well under the fan max width.
        expect(CARD_WIDTH + max).toBeLessThan(STACK_FAN_MAX_WIDTH);
    });
});
