// Limited drafted-set basics (issue #1115, #5106): `makeResolveBasicLand` binds
// each basic to its printing in the event's drafted Set — the definition's own
// printing when its home Set is the drafted one, else the `cardPrints` row the
// boundary read (`loadPrintIdsInSet`), else the definition itself.
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { basicLandCardIds, makeResolveBasicLand } from "../resolveBasicLand";

const mountain = getCardByName("Mountain");

describe("makeResolveBasicLand", () => {
    it("returns the definition's own printing when its home Set is the drafted Set", () => {
        const resolve = makeResolveBasicLand("lea", new Map());
        expect(resolve("R")).toEqual({
            cardId: mountain.id,
            cardName: "Mountain",
        });
    });

    it("prefers the definition's own printing over a table row in the same Set", () => {
        const resolve = makeResolveBasicLand(
            "lea",
            new Map([[mountain.id, "mountain-lea-reprint"]])
        );
        expect(resolve("R").cardId).toBe(mountain.id);
    });

    it("returns the table's printing in the drafted Set when the home Set differs", () => {
        const resolve = makeResolveBasicLand(
            "4ed",
            new Map([[mountain.id, "mountain-4ed-print"]])
        );
        expect(resolve("R")).toEqual({
            cardId: "mountain-4ed-print",
            cardName: "Mountain",
        });
    });

    it("falls back to the canonical printing when the drafted Set has no printing of the basic", () => {
        const resolve = makeResolveBasicLand("zzz", new Map());
        expect(resolve("R").cardId).toBe(mountain.id);
    });

    it("names the five basics' Card IDs for the boundary to read", () => {
        expect(basicLandCardIds()).toHaveLength(5);
        expect(basicLandCardIds()).toContain(mountain.id);
    });
});
