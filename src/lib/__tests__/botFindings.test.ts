// Bot Findings admin page — filter predicates (issue #4177). Pure, over a
// minimal slice of each row shape.
import { describe, it, expect } from "vitest";
import {
    distinctSorted,
    matchesClassFilters,
    matchesFindingFilters,
    EMPTY_CLASS_FILTERS,
    EMPTY_FINDING_FILTERS,
    type BotFindingClassRow,
    type BotFindingRow,
} from "../botFindings";

const FINDING = {
    name: "Grist, the Hunger Tide",
    targets: ["vintage-cube"],
    cause: "never-chosen",
    blame: "bot",
    status: "open",
} as unknown as BotFindingRow;

const CLASS = {
    key: "never-chosen › Sorcery › draw",
    cause: "never-chosen",
    blame: "bot",
    targetCounts: [
        { target: "vintage-cube", count: 3 },
        { target: "premodern-metagame", count: 0 },
    ],
} as unknown as BotFindingClassRow;

describe("distinctSorted", () => {
    it("returns the distinct, sorted, defined values of a column", () => {
        expect(
            distinctSorted(
                [{ v: "b" }, { v: "a" }, { v: "b" }, { v: undefined }],
                (r) => r.v
            )
        ).toEqual(["a", "b"]);
    });
});

describe("matchesFindingFilters", () => {
    it("passes everything under the empty filter", () => {
        expect(matchesFindingFilters(FINDING, EMPTY_FINDING_FILTERS)).toBe(
            true
        );
    });

    it("narrows by Target List", () => {
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                target: "premodern-metagame",
            })
        ).toBe(false);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                target: "vintage-cube",
            })
        ).toBe(true);
    });

    it("narrows by cause, blame and status", () => {
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                cause: "position-unmodelled",
            })
        ).toBe(false);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                blame: "harness",
            })
        ).toBe(false);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                status: "resolved",
            })
        ).toBe(false);
    });

    it("narrows by a case-insensitive card-name substring", () => {
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                query: "hunger",
            })
        ).toBe(true);
        expect(
            matchesFindingFilters(FINDING, {
                ...EMPTY_FINDING_FILTERS,
                query: "nonexistent",
            })
        ).toBe(false);
    });
});

describe("matchesClassFilters", () => {
    it("passes everything under the empty filter", () => {
        expect(matchesClassFilters(CLASS, EMPTY_CLASS_FILTERS)).toBe(true);
    });

    it("narrows by Target List, requiring a POSITIVE count on that Target", () => {
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                target: "vintage-cube",
            })
        ).toBe(true);
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                target: "premodern-metagame",
            })
        ).toBe(false);
    });

    it("narrows the class key by substring — the Ops/keywords filter", () => {
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                query: "draw",
            })
        ).toBe(true);
        expect(
            matchesClassFilters(CLASS, {
                ...EMPTY_CLASS_FILTERS,
                query: "destroy",
            })
        ).toBe(false);
    });
});
