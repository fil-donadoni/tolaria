// Own cost reduction (issue #9978): the cards Auto-Build's land drop exempts —
// delve (CR 702.66a), convoke (CR 702.51a), improvise (CR 702.126a) and a
// `selfCostReduction` such as affinity (CR 702.41a).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { reducesOwnCost } from "../ownCostReduction";

describe("reducesOwnCost", () => {
    it("delve reduces the card's own cost: Murktide Regent", () => {
        expect(reducesOwnCost(getCardByName("Murktide Regent"))).toBe(true);
    });

    it("affinity, a self cost reduction, does: Frogmite", () => {
        expect(reducesOwnCost(getCardByName("Frogmite"))).toBe(true);
    });

    it("a printed twelve-drop with no reduction does not: Blightsteel Colossus", () => {
        expect(reducesOwnCost(getCardByName("Blightsteel Colossus"))).toBe(
            false
        );
    });
});
