import { describe, expect, it } from "vitest";
import type { CardPrinting } from "@convex/cards";
import { defaultEdition, editionOptions } from "../editions";
import { matchesSets } from "~/components/lobby/deck-builder/useCardSearch";

const prints: CardPrinting[] = [
    { printId: "lea-id", setCode: "lea" },
    { printId: "leb-id", setCode: "leb" },
];

const forestPrints: CardPrinting[] = [
    { printId: "lea-forest", setCode: "lea" },
    { printId: "leb-forest-1", setCode: "leb" },
    { printId: "leb-forest-2", setCode: "leb" },
    { printId: "leb-forest-3", setCode: "leb" },
];

describe("editionOptions", () => {
    it("labels single-per-set printings by uppercase set code", () => {
        expect(editionOptions(prints)).toEqual([
            { printId: "lea-id", label: "LEA" },
            { printId: "leb-id", label: "LEB" },
        ]);
    });

    it("disambiguates same-set variants with #n", () => {
        expect(editionOptions(forestPrints)).toEqual([
            { printId: "lea-forest", label: "LEA" },
            { printId: "leb-forest-1", label: "LEB #1" },
            { printId: "leb-forest-2", label: "LEB #2" },
            { printId: "leb-forest-3", label: "LEB #3" },
        ]);
    });
});

describe("defaultEdition", () => {
    it("defaults to the original definition with no set filter", () => {
        expect(defaultEdition(prints, [])).toBe("lea-id");
    });

    it("prefers a printing in the active set when filtered", () => {
        expect(defaultEdition(prints, ["leb"])).toBe("leb-id");
    });

    it("falls back to the original when no printing matches the filter", () => {
        expect(defaultEdition(prints, ["unf"])).toBe("lea-id");
    });

    it("picks the first matching variant for same-set duplicates", () => {
        expect(defaultEdition(forestPrints, ["leb"])).toBe("leb-forest-1");
    });
});

describe("matchesSets (set filter)", () => {
    it("matches everything when no set is selected", () => {
        expect(matchesSets(prints, [], "any")).toBe(true);
    });

    it("matches when any printing belongs to a selected set", () => {
        expect(matchesSets(prints, ["leb"], "any")).toBe(true);
        expect(matchesSets(prints, ["lea"], "any")).toBe(true);
    });

    it("rejects when no printing belongs to a selected set", () => {
        expect(
            matchesSets([{ printId: "x", setCode: "lea" }], ["leb"], "any")
        ).toBe(false);
    });

    it("'all' mode requires a printing in every selected set", () => {
        // `prints` spans lea + leb (see fixture).
        expect(matchesSets(prints, ["lea", "leb"], "all")).toBe(true);
        expect(matchesSets(prints, ["lea", "unf"], "all")).toBe(false);
    });

    it("'any' mode matches when at least one selected set is present", () => {
        expect(matchesSets(prints, ["lea", "unf"], "any")).toBe(true);
    });
});
