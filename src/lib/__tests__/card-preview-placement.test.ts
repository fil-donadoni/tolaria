// Issue #5664 — the anchored Card Preview is ALWAYS fully inside the viewport,
// whatever its anchor and content height. Pins the pure placement function the
// component re-runs on every panel/viewport resize.
import { describe, it, expect } from "vitest";
import {
    ANCHORED_PREVIEW_VIEWPORT_PAD as PAD,
    clampAnchoredPreviewPosition,
} from "../card-preview-placement";

const DESKTOP = { width: 1440, height: 900 };
// A hand card: the lowest row of the board, its bottom near the screen edge.
const HAND_CARD = { top: 780, left: 600, right: 690, height: 120 };

function expectInside(
    pos: { top: number; left: number },
    width: number,
    height: number,
    viewport = DESKTOP
) {
    const shown = Math.min(height, viewport.height - PAD * 2);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.top + shown).toBeLessThanOrEqual(viewport.height);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.left + width).toBeLessThanOrEqual(viewport.width);
}

describe("clampAnchoredPreviewPosition keeps the preview on screen (issue #5664)", () => {
    it("lifts a hand card's preview above the bottom edge", () => {
        const pos = clampAnchoredPreviewPosition(HAND_CARD, 330, 520, DESKTOP);
        expect(pos.top).toBe(DESKTOP.height - PAD - 520);
        expectInside(pos, 330, 520);
    });

    it("keeps a long-oracle copy permanent (two faces) inside", () => {
        const pos = clampAnchoredPreviewPosition(HAND_CARD, 660, 780, DESKTOP);
        expectInside(pos, 660, 780);
    });

    it("pins a panel taller than the viewport to the top pad (capped, body scrolls)", () => {
        const pos = clampAnchoredPreviewPosition(HAND_CARD, 330, 1400, DESKTOP);
        expect(pos.top).toBe(PAD);
        expectInside(pos, 330, 1400);
    });

    it("re-clamps against a smaller viewport", () => {
        const small = { width: 1024, height: 600 };
        const card = { top: 480, left: 900, right: 990, height: 110 };
        const pos = clampAnchoredPreviewPosition(card, 330, 560, small);
        expectInside(pos, 330, 560, small);
    });
});
