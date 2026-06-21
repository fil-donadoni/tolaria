import { describe, it, expect } from "vitest";
import {
    isZonePickConfirmEnabled,
    pendingChoiceMin,
    pendingChoiceMax,
} from "../pending-choice-confirm";

// The Sylvan Library redesign (#438) relies on the shared zone-pick confirm
// gate enabling Done at the MINIMUM allowed selection of a ranged choice
// (CR 608.2 — the player may topdeck 0..N cards drawn this turn).
describe("isZonePickConfirmEnabled (Done/Skip gate, CR 608.2)", () => {
    it("treats a fixed-N count as exactly N", () => {
        expect(isZonePickConfirmEnabled(2, 1)).toBe(false);
        expect(isZonePickConfirmEnabled(2, 2)).toBe(true);
        expect(isZonePickConfirmEnabled(2, 3)).toBe(false);
    });

    it("enables Done at min === 0 with an empty buffer (Sylvan: keep all N)", () => {
        // N = 2, life permits keeping both → range {0,2}. Done is enabled with
        // nothing selected (Skip = pay 4 × N).
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 0)).toBe(true);
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 1)).toBe(true);
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 2)).toBe(true);
    });

    it("rejects selecting past max (range guard)", () => {
        expect(isZonePickConfirmEnabled({ min: 0, max: 2 }, 3)).toBe(false);
    });

    it("forces a non-zero minimum when life can't cover keeping all N (CR 119.4)", () => {
        // life 6 → keep at most 1 of 2 → at least 1 must be topdecked → {1,2}.
        expect(isZonePickConfirmEnabled({ min: 1, max: 2 }, 0)).toBe(false);
        expect(isZonePickConfirmEnabled({ min: 1, max: 2 }, 1)).toBe(true);
        expect(isZonePickConfirmEnabled({ min: 1, max: 2 }, 2)).toBe(true);
    });

    it("with life < 4 the minimum equals N (all must be topdecked)", () => {
        expect(isZonePickConfirmEnabled({ min: 2, max: 2 }, 1)).toBe(false);
        expect(isZonePickConfirmEnabled({ min: 2, max: 2 }, 2)).toBe(true);
    });

    it("min/max readers handle both count shapes", () => {
        expect(pendingChoiceMin(2)).toBe(2);
        expect(pendingChoiceMax(2)).toBe(2);
        expect(pendingChoiceMin({ min: 0, max: 2 })).toBe(0);
        expect(pendingChoiceMax({ min: 0, max: 2 })).toBe(2);
    });
});
