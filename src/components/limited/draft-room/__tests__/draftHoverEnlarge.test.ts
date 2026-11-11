// Hover-enlarge placement (issue #9166): centred on its tile, clamped inside
// the viewport, never taller than the viewport.
import { describe, it, expect } from "vitest";
import { ENLARGED_MIN_W, enlargedPlacement } from "../draftHoverEnlarge";

const VIEWPORT = { width: 1440, height: 900 };

describe("enlargedPlacement", () => {
    it("centres on the tile and grows it", () => {
        const p = enlargedPlacement(
            { left: 600, top: 300, width: 180, height: 252 },
            VIEWPORT
        );
        expect(p.width).toBeGreaterThanOrEqual(ENLARGED_MIN_W);
        expect(p.left + p.width / 2).toBeCloseTo(690, 0);
    });

    it("clamps a corner tile inside the viewport", () => {
        const p = enlargedPlacement(
            { left: 0, top: 0, width: 150, height: 210 },
            VIEWPORT
        );
        expect(p.left).toBeGreaterThanOrEqual(8);
        expect(p.top).toBeGreaterThanOrEqual(8);
        const far = enlargedPlacement(
            { left: 1300, top: 800, width: 150, height: 210 },
            VIEWPORT
        );
        expect(far.left + far.width).toBeLessThanOrEqual(1440 - 8);
        expect(far.top + (far.width * 7) / 5).toBeLessThanOrEqual(900 - 8);
    });

    it("shrinks to fit a short viewport", () => {
        const p = enlargedPlacement(
            { left: 100, top: 100, width: 150, height: 210 },
            { width: 1000, height: 400 }
        );
        expect((p.width * 7) / 5).toBeLessThanOrEqual(400 - 16);
    });
});
