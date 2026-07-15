import { describe, expect, it } from "vitest";
import { decodeFilters, encodeFilters } from "../filterSearch";
import { DEFAULT_FILTERS, type CardSearchFilters } from "../useCardSearch";

describe("filterSearch encode/decode", () => {
    it("encodes default filters to an empty search object", () => {
        expect(encodeFilters(DEFAULT_FILTERS)).toEqual({});
    });

    it("decodes an empty search object back to defaults", () => {
        expect(decodeFilters({})).toEqual(DEFAULT_FILTERS);
    });

    it("round-trips a fully populated filter set", () => {
        const filters: CardSearchFilters = {
            text: "lightning bolt",
            colors: ["W", "R"],
            includeColorless: true,
            colorMode: "include-all",
            types: ["Creature", "Legendary"],
            typeMode: "all",
            manaValues: [0, 3, 7],
            sets: ["lea", "arn"],
            setMode: "all",
            cube: "vintage-cube",
        };
        expect(decodeFilters(encodeFilters(filters))).toEqual(filters);
    });

    it("round-trips a selected cube via the `cube` key", () => {
        const search = encodeFilters({
            ...DEFAULT_FILTERS,
            cube: "vintage-cube",
        });
        expect(search).toEqual({ cube: "vintage-cube" });
        expect(decodeFilters(search).cube).toBe("vintage-cube");
    });

    it("keeps the query string clean (plain string values, no JSON)", () => {
        const search = encodeFilters({
            ...DEFAULT_FILTERS,
            text: "bolt",
            colors: ["R"],
            types: ["Instant"],
        });
        expect(search).toEqual({ q: "bolt", c: "R", t: "Instant" });
    });

    it("ignores junk color letters and non-integer mana values", () => {
        const decoded = decodeFilters({ c: "RxZ", mv: "2,foo,5" });
        expect(decoded.colors).toEqual(["R"]);
        expect(decoded.manaValues).toEqual([2, 5]);
    });

    it("falls back to default modes on unknown values", () => {
        const decoded = decodeFilters({
            cm: "bogus",
            tm: "bogus",
            sm: "bogus",
        });
        expect(decoded.colorMode).toBe(DEFAULT_FILTERS.colorMode);
        expect(decoded.typeMode).toBe(DEFAULT_FILTERS.typeMode);
        expect(decoded.setMode).toBe(DEFAULT_FILTERS.setMode);
    });
});
