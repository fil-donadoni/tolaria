import { describe, it, expect } from "vitest";
import { manaValue } from "../constants";

describe("manaValue (CR 202.3)", () => {
    it("returns 0 when cost is undefined (lands)", () => {
        expect(manaValue(undefined)).toBe(0);
    });

    it("sums a single colored pip", () => {
        expect(manaValue({ R: 1 })).toBe(1);
    });

    it("sums generic and colored together (Serra Angel)", () => {
        expect(manaValue({ X: 3, W: 1 })).toBe(4);
    });

    it("treats string X as 0 (variable cost not committed)", () => {
        expect(manaValue({ X: "X", R: 1 })).toBe(1);
    });

    it("sums 4 generic + 2 green (Craw Wurm)", () => {
        expect(manaValue({ X: 4, G: 2 })).toBe(6);
    });

    it("returns 0 for the empty cost (Mox)", () => {
        expect(manaValue({})).toBe(0);
    });
});
