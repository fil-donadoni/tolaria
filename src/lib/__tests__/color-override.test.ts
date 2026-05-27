import { describe, it, expect } from "vitest";
import { getColorOverrideDisplay } from "../color-override";

describe("getColorOverrideDisplay", () => {
    it("returns null for empty array", () => {
        expect(getColorOverrideDisplay([])).toBeNull();
    });

    it("returns White for ['W']", () => {
        const result = getColorOverrideDisplay(["W"]);
        expect(result).toEqual({
            name: "White",
            solid: "#f0e6b8",
            inner: "rgba(240,230,184,0.60)",
        });
    });

    it("returns Blue for ['U']", () => {
        expect(getColorOverrideDisplay(["U"])!.name).toBe("Blue");
    });

    it("returns Black (purple-dark) for ['B']", () => {
        const result = getColorOverrideDisplay(["B"])!;
        expect(result.name).toBe("Black");
        expect(result.solid).toBe("#5c3d6e");
    });

    it("returns Red for ['R']", () => {
        expect(getColorOverrideDisplay(["R"])!.name).toBe("Red");
    });

    it("returns Green for ['G']", () => {
        expect(getColorOverrideDisplay(["G"])!.name).toBe("Green");
    });

    it("returns multicolor gold for 2+ codes", () => {
        const result = getColorOverrideDisplay(["W", "U"])!;
        expect(result.name).toBe("White / Blue");
        expect(result.solid).toBe("#c9a84c");
    });

    it("returns null for unknown single code", () => {
        expect(getColorOverrideDisplay(["X"])).toBeNull();
    });

    it("handles 3-color multicolor", () => {
        const result = getColorOverrideDisplay(["R", "G", "B"])!;
        expect(result.name).toBe("Red / Green / Black");
        expect(result.solid).toBe("#c9a84c");
    });
});
