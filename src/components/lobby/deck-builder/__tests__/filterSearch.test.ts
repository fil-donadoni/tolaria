import { describe, expect, it } from "vitest";
import {
    buildSearch,
    decodeFilters,
    decodeFormat,
    encodeFilters,
} from "../filterSearch";
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
            hideUnavailable: false,
            showTokens: true,
            sort: "color",
            sortDirection: "desc",
        };
        expect(decodeFilters(encodeFilters(filters))).toEqual(filters);
    });

    it("round-trips a non-default sort via the `sort` key", () => {
        const search = encodeFilters({ ...DEFAULT_FILTERS, sort: "name" });
        expect(search).toEqual({ sort: "name" });
        expect(decodeFilters(search).sort).toBe("name");
    });

    it("omits the default sort from the search object", () => {
        expect(
            encodeFilters({ ...DEFAULT_FILTERS, sort: "manaValue" })
        ).toEqual({});
    });

    it("falls back to the default sort on an unknown value", () => {
        expect(decodeFilters({ sort: "bogus" }).sort).toBe(
            DEFAULT_FILTERS.sort
        );
    });

    it("round-trips a non-default sort direction via the `sd` key", () => {
        const search = encodeFilters({
            ...DEFAULT_FILTERS,
            sortDirection: "desc",
        });
        expect(search).toEqual({ sd: "desc" });
        expect(decodeFilters(search).sortDirection).toBe("desc");
    });

    it("omits the default sort direction from the search object", () => {
        expect(
            encodeFilters({ ...DEFAULT_FILTERS, sortDirection: "asc" })
        ).toEqual({});
    });

    it("falls back to the default sort direction on an unknown value", () => {
        expect(decodeFilters({ sd: "bogus" }).sortDirection).toBe(
            DEFAULT_FILTERS.sortDirection
        );
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

/**
 * The Format seed is the only non-filter key on `/decks/create`, and a search
 * write REPLACES the whole object — so `buildSearch` is the one place that can
 * lose it. It did: `?format=manual` survived the navigation from the lobby but
 * was dropped by the first keystroke in the search box, leaving the builder on
 * Freeform after a reload with manual mode unreachable by link.
 */
describe("buildSearch — Format seed survives a filter write", () => {
    it("carries an existing format through a filters-only write", () => {
        const next = buildSearch(
            { format: "manual" },
            { filters: { ...DEFAULT_FILTERS, text: "sliver" } }
        );
        expect(next).toEqual({ format: "manual", q: "sliver" });
    });

    it("carries existing filters through a format-only write", () => {
        const next = buildSearch({ q: "sliver" }, { format: "manual" });
        expect(next).toEqual({ format: "manual", q: "sliver" });
    });

    it("applies both in a single write (no clobber)", () => {
        const next = buildSearch(
            { format: "manual" },
            {
                filters: { ...DEFAULT_FILTERS, cube: "vintage-cube" },
                format: "freeform",
            }
        );
        expect(next).toEqual({ format: "freeform", cube: "vintage-cube" });
    });

    it("emits no format key when there is none to carry", () => {
        const next = buildSearch(
            {},
            { filters: { ...DEFAULT_FILTERS, text: "bolt" } }
        );
        expect(next).toEqual({ q: "bolt" });
    });

    it("drops an unknown format value rather than propagating it", () => {
        expect(buildSearch({ format: "not-a-format" }, {})).toEqual({});
        expect(decodeFormat({ format: "not-a-format" })).toBeUndefined();
        expect(decodeFormat({ format: "manual" })).toBe("manual");
    });
});
