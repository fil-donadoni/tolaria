import { describe, it, expect } from "vitest";
import {
    edgeScrollVelocity,
    EDGE_BAND_PX,
    EDGE_MAX_SPEED_PX_S,
} from "../edge-scroll";

// Issue #9813 — the edge-band → scroll velocity mapping behind the ordered
// drag strip's auto-scroll.
describe("edgeScrollVelocity", () => {
    const L = 100;
    const R = 900; // 800px visible strip, wide enough for full bands

    it("is zero outside both edge bands", () => {
        expect(edgeScrollVelocity(500, L, R)).toBe(0);
        expect(edgeScrollVelocity(L + EDGE_BAND_PX, L, R)).toBe(0);
        expect(edgeScrollVelocity(R - EDGE_BAND_PX, L, R)).toBe(0);
    });

    it("is signed by side: negative in the left band, positive in the right", () => {
        expect(edgeScrollVelocity(L + 10, L, R)).toBeLessThan(0);
        expect(edgeScrollVelocity(R - 10, L, R)).toBeGreaterThan(0);
    });

    it("ramps monotonically toward each edge", () => {
        const left = [70, 50, 30, 10, 0].map((d) =>
            Math.abs(edgeScrollVelocity(L + d, L, R))
        );
        const right = [70, 50, 30, 10, 0].map((d) =>
            edgeScrollVelocity(R - d, L, R)
        );
        for (const speeds of [left, right]) {
            for (let i = 1; i < speeds.length; i++) {
                expect(speeds[i]).toBeGreaterThan(speeds[i - 1]);
            }
        }
    });

    it("is capped at the max speed at and past the edge", () => {
        expect(edgeScrollVelocity(L, L, R)).toBe(-EDGE_MAX_SPEED_PX_S);
        expect(edgeScrollVelocity(L - 300, L, R)).toBe(-EDGE_MAX_SPEED_PX_S);
        expect(edgeScrollVelocity(R, L, R)).toBe(EDGE_MAX_SPEED_PX_S);
        expect(edgeScrollVelocity(R + 300, L, R)).toBe(EDGE_MAX_SPEED_PX_S);
    });

    it("shrinks the bands on a narrow strip so the middle stays still", () => {
        // 200px strip → bands of 50px; the center never scrolls.
        expect(edgeScrollVelocity(100, 0, 200)).toBe(0);
        expect(edgeScrollVelocity(60, 0, 200)).toBe(0);
        expect(edgeScrollVelocity(40, 0, 200)).toBeLessThan(0);
        expect(edgeScrollVelocity(160, 0, 200)).toBeGreaterThan(0);
    });

    it("is zero for a degenerate strip", () => {
        expect(edgeScrollVelocity(0, 0, 0)).toBe(0);
        expect(edgeScrollVelocity(5, 10, 0)).toBe(0);
    });
});
