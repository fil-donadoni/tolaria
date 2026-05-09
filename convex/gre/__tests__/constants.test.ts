import { describe, it, expect } from "vitest";
import { isTapLockedBySummoningSickness, manaValue } from "../constants";
import { makeInstance } from "../../cards/__tests__/setup";

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

describe("isTapLockedBySummoningSickness (CR 302.1)", () => {
    it("locks a creature with summoning sickness", () => {
        const card = makeInstance("55fe6449-1f23-43dc-adee-d144cd505b5c", {
            isSummoningSick: true,
        });
        expect(isTapLockedBySummoningSickness(card)).toBe(true);
    });

    it("does not lock a creature without summoning sickness", () => {
        const card = makeInstance("55fe6449-1f23-43dc-adee-d144cd505b5c", {
            isSummoningSick: false,
        });
        expect(isTapLockedBySummoningSickness(card)).toBe(false);
    });

    it("never locks a non-creature even when flagged sick", () => {
        // Mox Sapphire (artifact) — summoning sickness only applies to
        // creatures (CR 302.1). Mana abilities of non-creature permanents
        // are usable on the turn they ETB.
        const mox = makeInstance("82da0972-b17b-4600-9efd-e9430a0db04b", {
            isSummoningSick: true,
        });
        expect(isTapLockedBySummoningSickness(mox)).toBe(false);
    });
});
