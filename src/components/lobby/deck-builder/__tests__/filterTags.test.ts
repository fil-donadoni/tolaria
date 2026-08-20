// Issue #2585 — the applied-filter TAG ROW's model.
//
// With the filter controls behind a button, the tag row is the only thing on
// screen that says what is being filtered, and the button's badge count is
// `describeActiveFilters(...).length`. Two things therefore have to hold, and
// neither is checkable by a type:
//
//   1. **Parity with `hasAnyFilter`.** The search hook's own idle gate
//      (`useCardSearch.ts`) decides whether results render at all. If the tag
//      row's field list drifts from it, a filter can be applied with no chip
//      and no badge — invisible state, the exact bug class the row exists to
//      kill — or a chip can claim a filter the search does not apply.
//   2. **Every tag can undo itself, and the undo lands on the DEFAULT.** A
//      chip whose × leaves the field non-default is a chip that cannot be
//      removed.
//
// Both are asserted over a MATRIX of one-field-at-a-time filter sets, so a new
// field added to `CardSearchFilters` without a tag fails here rather than
// shipping silently.
import { describe, it, expect } from "vitest";
import {
    DEFAULT_FILTERS,
    hasAnyFilter,
    type CardSearchFilters,
} from "../useCardSearch";
import {
    clearAllFilters,
    describeActiveFilters,
    TAGGED_DEFAULTS,
    type FilterTagField,
} from "../filterTags";

/** One entry per field the tag row claims to cover, each a filter set with
 *  exactly that field non-default. Keyed by field so a missing key is a
 *  compile error the moment `FilterTagField` grows. */
const ONE_FIELD_ACTIVE: Record<FilterTagField, Partial<CardSearchFilters>> = {
    text: { text: "bolt" },
    colors: { colors: ["W", "U"] },
    includeColorless: { includeColorless: true },
    types: { types: ["Creature", "Instant"] },
    manaValues: { manaValues: [0, 7] },
    sets: { sets: ["lea", "arn"] },
    cube: { cube: "vintage-cube" },
    hideUnavailable: { hideUnavailable: false },
    showTokens: { showTokens: true },
};

function withFields(patch: Partial<CardSearchFilters>): CardSearchFilters {
    return { ...DEFAULT_FILTERS, ...patch };
}

const FIELDS = Object.keys(ONE_FIELD_ACTIVE) as FilterTagField[];

describe("describeActiveFilters — parity with hasAnyFilter (#2585)", () => {
    it("produces no tags for the default filter set", () => {
        expect(describeActiveFilters(DEFAULT_FILTERS)).toEqual([]);
        expect(hasAnyFilter(DEFAULT_FILTERS)).toBe(false);
    });

    it("produces no tags for ordering — sort is not a filter", () => {
        const sorted = withFields({ sort: "name", sortDirection: "desc" });
        expect(hasAnyFilter(sorted)).toBe(false);
        expect(describeActiveFilters(sorted)).toEqual([]);
    });

    it("produces no tags for a match MODE with nothing selected", () => {
        const modes = withFields({
            colorMode: "at-most",
            typeMode: "all",
            setMode: "all",
        });
        expect(hasAnyFilter(modes)).toBe(false);
        expect(describeActiveFilters(modes)).toEqual([]);
    });

    for (const field of FIELDS) {
        it(`tags ${field} exactly when hasAnyFilter does`, () => {
            const filters = withFields(ONE_FIELD_ACTIVE[field]);
            expect(hasAnyFilter(filters)).toBe(true);
            const tags = describeActiveFilters(filters);
            expect(tags.length).toBeGreaterThan(0);
            expect(tags.every((t) => t.field === field)).toBe(true);
        });
    }

    it("gives a whitespace-only text query no tag (the search treats it as inert)", () => {
        const filters = withFields({ text: "   " });
        expect(hasAnyFilter(filters)).toBe(false);
        expect(describeActiveFilters(filters)).toEqual([]);
    });

    it("is one tag PER VALUE, not per field", () => {
        const filters = withFields({
            colors: ["W", "U", "B"],
            types: ["Creature"],
            manaValues: [1, 2],
            sets: ["lea"],
        });
        const tags = describeActiveFilters(filters);
        expect(tags.map((t) => t.label)).toEqual([
            "White",
            "Blue",
            "Black",
            "Creature",
            "MV 1",
            "MV 2",
            "LEA",
        ]);
        expect(new Set(tags.map((t) => t.id)).size).toBe(tags.length);
    });

    it("labels the 7 bucket as the open-ended '7+' the filter actually means", () => {
        const tags = describeActiveFilters(withFields({ manaValues: [7] }));
        expect(tags[0].label).toBe("MV 7+");
    });
});

describe("removing one tag (#2585)", () => {
    for (const field of FIELDS) {
        it(`the first ${field} tag's remove() drops exactly that value`, () => {
            const filters = withFields(ONE_FIELD_ACTIVE[field]);
            const tags = describeActiveFilters(filters);
            const next = tags[0].remove(filters);
            // Pure — the input is never mutated.
            expect(filters).toEqual(withFields(ONE_FIELD_ACTIVE[field]));
            expect(describeActiveFilters(next).length).toBe(tags.length - 1);
        });
    }

    it("removing one colour leaves the others alone", () => {
        const filters = withFields({ colors: ["W", "U", "B"] });
        const blue = describeActiveFilters(filters).find(
            (t) => t.label === "Blue"
        )!;
        expect(blue.remove(filters).colors).toEqual(["W", "B"]);
    });
});

describe("clearAllFilters (#2585)", () => {
    it("empties every tagged field back to its default", () => {
        const everything = withFields(
            Object.assign({}, ...Object.values(ONE_FIELD_ACTIVE))
        );
        expect(describeActiveFilters(everything).length).toBeGreaterThan(0);
        const cleared = clearAllFilters(everything);
        expect(describeActiveFilters(cleared)).toEqual([]);
        expect(hasAnyFilter(cleared)).toBe(false);
        for (const field of FIELDS) {
            expect(cleared[field]).toEqual(TAGGED_DEFAULTS[field]);
        }
    });

    it("leaves ORDERING untouched — clearing filters is not resetting the view", () => {
        const everything = withFields({
            ...Object.assign({}, ...Object.values(ONE_FIELD_ACTIVE)),
            sort: "name",
            sortDirection: "desc",
            colorMode: "at-most",
        });
        const cleared = clearAllFilters(everything);
        expect(cleared.sort).toBe("name");
        expect(cleared.sortDirection).toBe("desc");
        expect(cleared.colorMode).toBe("at-most");
    });
});
