import { describe, expect, it } from "vitest";
import { clampMenuPosition } from "../draftMenuPosition";

const viewport = { width: 820, height: 1180 };
const menu = { width: 160, height: 90 };

describe("clampMenuPosition (issue #9166)", () => {
    it("leaves a menu that fits where the click put it", () => {
        expect(clampMenuPosition({ x: 100, y: 200 }, menu, viewport)).toEqual({
            x: 100,
            y: 200,
        });
    });

    it("lifts a menu opened near the bottom edge fully into view", () => {
        const p = clampMenuPosition({ x: 100, y: 1150 }, menu, viewport);
        expect(p.y + menu.height).toBeLessThanOrEqual(viewport.height);
    });

    it("pulls a menu opened near the right edge fully into view", () => {
        const p = clampMenuPosition({ x: 800, y: 200 }, menu, viewport);
        expect(p.x + menu.width).toBeLessThanOrEqual(viewport.width);
    });
});
