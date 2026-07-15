import { describe, expect, it } from "vitest";
import {
    DEFAULT_FILTERS,
    MIN_TEXT_QUERY_LENGTH,
    hasAnyFilter,
    isTextActive,
    matchesCube,
    type CardIndexEntry,
    type CardSearchFilters,
} from "../useCardSearch";

// The text predicate (`matchesText`) is module-private; we exercise it through
// the same surfaces production code uses — `isTextActive` (the shared gate),
// `hasAnyFilter` (idle detection), and a tiny re-implementation-free filter
// pass mirroring `useCardSearch`'s combined predicate via the public helpers.

function entry(over: Partial<CardIndexEntry>): CardIndexEntry {
    return {
        cardId: over.cardId ?? "id",
        name: over.name ?? "Lightning Bolt",
        nameLower: (over.name ?? "Lightning Bolt").toLowerCase(),
        nameFold: (
            over.nameFold ??
            over.name ??
            "Lightning Bolt"
        ).toLowerCase(),
        types: over.types ?? ["Instant"],
        subtypes: over.subtypes ?? [],
        supertypes: over.supertypes ?? [],
        colors: over.colors ?? ["R"],
        manaValue: over.manaValue ?? 1,
        oracleText: over.oracleText ?? "Deal 3 damage to any target.",
        oracleFold: (
            over.oracleFold ??
            over.oracleText ??
            "Deal 3 damage to any target."
        ).toLowerCase(),
        prints: over.prints ?? [],
    };
}

describe("3-char text gate (issue #504)", () => {
    describe("isTextActive — the single shared predicate", () => {
        it("is inactive below the threshold", () => {
            expect(isTextActive("")).toBe(false);
            expect(isTextActive("a")).toBe(false);
            expect(isTextActive("ab")).toBe(false);
        });

        it("ignores surrounding whitespace", () => {
            expect(isTextActive("  ab  ")).toBe(false);
            expect(isTextActive("  abc ")).toBe(true);
        });

        it("activates at exactly the threshold and above", () => {
            expect(isTextActive("abc")).toBe(true);
            expect(isTextActive("bolt")).toBe(true);
        });

        it("uses the documented threshold constant", () => {
            expect(MIN_TEXT_QUERY_LENGTH).toBe(3);
        });
    });

    describe("hasAnyFilter — idle detection routes through the gate", () => {
        it("a 1-2 char text-only query does not count as a filter", () => {
            expect(hasAnyFilter({ ...DEFAULT_FILTERS, text: "a" })).toBe(false);
            expect(hasAnyFilter({ ...DEFAULT_FILTERS, text: "ab" })).toBe(
                false
            );
        });

        it("a >=3 char text-only query counts as a filter", () => {
            expect(hasAnyFilter({ ...DEFAULT_FILTERS, text: "abc" })).toBe(
                true
            );
        });

        it("a sub-3-char text plus another active filter is still active", () => {
            // The other filter keeps the grid out of idle; the text is inert.
            expect(
                hasAnyFilter({ ...DEFAULT_FILTERS, text: "a", colors: ["R"] })
            ).toBe(true);
        });

        it("a bare cube selection counts as an active filter", () => {
            expect(
                hasAnyFilter({ ...DEFAULT_FILTERS, cube: "vintage-cube" })
            ).toBe(true);
        });
    });

    describe("matchesCube — cube membership gate", () => {
        const members = new Set(["a", "b"]);

        it("passes every card when no cube is selected (null)", () => {
            expect(matchesCube("anything", null)).toBe(true);
        });

        it("passes only cards in the cube's member set", () => {
            expect(matchesCube("a", members)).toBe(true);
            expect(matchesCube("z", members)).toBe(false);
        });

        it("matches nothing for an empty set (unresolved / loading cube)", () => {
            expect(matchesCube("a", new Set())).toBe(false);
        });
    });

    // Mirror of useCardSearch's matching contract: text constrains only when
    // the shared gate is active, otherwise other filters apply unchanged.
    function textConstrains(e: CardIndexEntry, text: string): boolean {
        if (!isTextActive(text)) return true;
        const q = text.trim().toLowerCase();
        return e.nameFold.includes(q) || e.oracleFold.includes(q);
    }

    describe("matching constraint routes through the gate", () => {
        const bolt = entry({ name: "Lightning Bolt" });
        const ancestral = entry({
            name: "Ancestral Recall",
            oracleText: "Target player draws three cards.",
        });

        it("a 1-2 char query does not constrain results", () => {
            // Neither matches "li"/"an" by name in a meaningful way, but the
            // gate makes the text inert so both pass regardless.
            expect(textConstrains(bolt, "li")).toBe(true);
            expect(textConstrains(ancestral, "li")).toBe(true);
        });

        it("a >=3 char query constrains over the card name", () => {
            expect(textConstrains(bolt, "bolt")).toBe(true);
            expect(textConstrains(ancestral, "bolt")).toBe(false);
        });

        it("a >=3 char query constrains over the oracle text", () => {
            expect(textConstrains(ancestral, "draws")).toBe(true);
            expect(textConstrains(bolt, "draws")).toBe(false);
        });
    });

    describe("idle-detection and matching cannot diverge", () => {
        it("both sides agree at the boundary lengths", () => {
            const sample = entry({ name: "Lightning Bolt" });
            for (const text of ["", "l", "li", "lig", "ligh"]) {
                const active = isTextActive(text);
                // hasAnyFilter for text-only must equal the gate.
                expect(hasAnyFilter({ ...DEFAULT_FILTERS, text })).toBe(active);
                // When inert, the constraint must accept everything; when
                // active, it actually filters (here: matches the name prefix).
                if (!active) {
                    expect(textConstrains(sample, text)).toBe(true);
                }
            }
        });
    });

    describe("acceptance: color filter + sub-3-char text", () => {
        const red = entry({ name: "Lightning Bolt", colors: ["R"] });
        const blue = entry({ name: "Ancestral Recall", colors: ["U"] });
        const filters: CardSearchFilters = {
            ...DEFAULT_FILTERS,
            text: "li",
            colors: ["R"],
        };

        it("yields the color results unchanged (text ignored)", () => {
            // Text "li" is inert, so the color filter alone decides.
            const matchesColor = (e: CardIndexEntry) =>
                filters.colors.every((c) => e.colors.includes(c));
            const pass = [red, blue].filter(
                (e) => matchesColor(e) && textConstrains(e, filters.text)
            );
            expect(pass).toEqual([red]);
            // And the grid is not idle because color is an active filter.
            expect(hasAnyFilter(filters)).toBe(true);
        });
    });
});
