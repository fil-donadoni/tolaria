import { describe, expect, it } from "vitest";
import { isManaCostCovered, manaCostToString } from "../card-utils";
import { normalizeManaCost } from "@convex/gre/state";
import { getDefinition } from "@convex/cards";

// Guild-hybrid pips on the CLIENT (CR 202.1a, issues #1738/#1740). Two cost
// SHAPES reach these helpers and both must work: a card's PRINTED cost (the
// `hybrid` colour-pair array) and a live `PendingCast.manaCost` (already
// NORMALIZED, pips as composite `"R/W"` keys).

const FIGURE_OF_DESTINY = "0da69523-cece-425a-b08a-fb27fac29374";

describe("manaCostToString renders hybrid pips (CR 202.1a)", () => {
    it("emits the printed `{R/W}` token, not a dropped pip", () => {
        expect(manaCostToString({ hybrid: [["R", "W"]] })).toBe("{R/W}");
        // The token maps to the `R_W.svg` symbol asset (slash → underscore),
        // exactly as `{B/P}` does — so the colour ORDER must be the printed
        // one, not WUBRG order.
        expect(manaCostToString({ hybrid: [["W", "R"]] })).toBe("{R/W}");
        expect(manaCostToString({ hybrid: [["W", "G"]] })).toBe("{G/W}");
    });

    it("orders generic before the pips", () => {
        expect(
            manaCostToString({
                generic: 1,
                hybrid: [
                    ["G", "W"],
                    ["G", "W"],
                ],
            })
        ).toBe("{1}{G/W}{G/W}");
    });

    it("renders a real card's printed cost", () => {
        const def = getDefinition(FIGURE_OF_DESTINY);
        expect(manaCostToString(def.manaCost)).toBe("{R/W}");
    });

    it("also renders a NORMALIZED cost's composite keys", () => {
        // The payment banner is handed `PendingCast.manaCost`, not a printed
        // cost — dropping this shape would make the owed pips invisible.
        const normalized = normalizeManaCost({
            generic: 1,
            hybrid: [["R", "W"]],
        });
        expect(manaCostToString(normalized)).toBe("{1}{R/W}");
    });
});

describe("client isManaCostCovered agrees with the engine (CR 601.2g)", () => {
    it("owes a hybrid pip from a printed cost", () => {
        const cost = { hybrid: [["R", "W"] as [string, string]] } as never;
        expect(isManaCostCovered({ R: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ W: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ G: 1 }, cost)).toBe(false);
        expect(isManaCostCovered({}, cost)).toBe(false);
    });

    it("owes a hybrid pip from a NORMALIZED cost too", () => {
        const cost = normalizeManaCost({
            generic: 1,
            hybrid: [["R", "W"]],
        }) as never;
        expect(isManaCostCovered({ R: 1, G: 1 }, cost)).toBe(true);
        // Two mana of an unrelated colour cover the generic but not the pip.
        expect(isManaCostCovered({ G: 2 }, cost)).toBe(false);
    });
});
