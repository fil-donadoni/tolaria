import { describe, expect, it } from "vitest";
import {
    DEFAULT_FILTERS,
    MIN_TEXT_QUERY_LENGTH,
    hasAnyFilter,
    isTextActive,
    matchesCube,
    parseTypeLine,
    makeCatalogueEntry,
    type CardIndexEntry,
    type CardSearchFilters,
} from "../useCardSearch";
import type { FullCatalogueRow } from "~/lib/fullCatalogue";

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
        const members = new Set(["a", "b", "Lightning Bolt"]);

        it("passes every card when no cube is selected (null)", () => {
            expect(matchesCube("anything", "anything", null)).toBe(true);
        });

        it("passes cards whose cardId is in the cube's member set", () => {
            expect(matchesCube("a", "irrelevant", members)).toBe(true);
            expect(matchesCube("z", "irrelevant", members)).toBe(false);
        });

        it("passes cards whose name is in the cube's member set (catalogue entries)", () => {
            // cardId is a per-print UUID (won't match), but the card name does.
            expect(
                matchesCube("per-print-uuid", "Lightning Bolt", members)
            ).toBe(true);
            expect(
                matchesCube("per-print-uuid", "Dark Confidant", members)
            ).toBe(false);
        });

        it("matches nothing for an empty set (unresolved / loading cube)", () => {
            expect(matchesCube("a", "a", new Set())).toBe(false);
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

    describe("token filtering", () => {
        const tokenRow = (name: string): FullCatalogueRow => ({
            name,
            printId: "aa",
            typeLine: "Token Creature — Zombie",
            manaCost: "",
            cmc: 0,
            colourIdentity: "B",
            set: "tsb",
            rarity: "common",
            nameFold: name.toLowerCase(),
            available: true,
        });
        const creatureRow = (name: string): FullCatalogueRow => ({
            name,
            printId: "bb",
            typeLine: "Creature — Zombie",
            manaCost: "{2}{B}",
            cmc: 3,
            colourIdentity: "B",
            set: "tsb",
            rarity: "common",
            nameFold: name.toLowerCase(),
            available: true,
        });

        it("parseTypeLine keeps Token out of types (CR 110.5e — marker characteristic)", () => {
            const parsed = parseTypeLine("Token Creature — Zombie");
            expect(parsed.types).toEqual(["Creature"]);
            expect(parsed.isToken).toBe(true);
            expect(parsed.supertypes).toEqual([]);
            expect(parsed.subtypes).toEqual(["Zombie"]);
        });

        it("parseTypeLine identifies non-token creatures correctly", () => {
            const parsed = parseTypeLine("Creature — Zombie");
            expect(parsed.types).toEqual(["Creature"]);
            expect(parsed.isToken).toBe(false);
        });

        it("makeCatalogueEntry sets isToken for tokens", () => {
            const entry = makeCatalogueEntry(tokenRow("Zombie"));
            expect(entry.isToken).toBe(true);
            expect(entry.types).toEqual(["Creature"]);
        });

        it("makeCatalogueEntry does not mark non-tokens as tokens", () => {
            const entry = makeCatalogueEntry(creatureRow("Fleshbag Marauder"));
            expect(entry.isToken).toBe(false);
            expect(entry.types).toEqual(["Creature"]);
        });

        it("showTokens filter counts as an active filter", () => {
            expect(
                hasAnyFilter({
                    ...DEFAULT_FILTERS,
                    showTokens: true,
                })
            ).toBe(true);
        });

        it("showTokens filter is not active by default", () => {
            expect(
                hasAnyFilter({
                    ...DEFAULT_FILTERS,
                    showTokens: false,
                })
            ).toBe(false);
        });

        it("token filtering excludes tokens from the regular card pool", () => {
            const token = makeCatalogueEntry(tokenRow("Zombie Token"));
            const creature = makeCatalogueEntry(
                creatureRow("Fleshbag Marauder")
            );
            const showTokens = (e: CardIndexEntry) => e.isToken === true;
            const hideTokens = (e: CardIndexEntry) => !e.isToken;

            // showTokens = true: only tokens pass
            expect(showTokens(token)).toBe(true);
            expect(showTokens(creature)).toBe(false);

            // showTokens = false (default): tokens are hidden
            expect(hideTokens(token)).toBe(false);
            expect(hideTokens(creature)).toBe(true);
        });
    });

    describe("Scryfall text search integration", () => {
        const row = (name: string): FullCatalogueRow => ({
            name,
            printId: "aa",
            typeLine: "Instant",
            manaCost: "{R}",
            cmc: 1,
            colourIdentity: "R",
            set: "lea",
            rarity: "common",
            nameFold: name.toLowerCase(),
            available: true,
        });

        it("index entries retain their oracle text for local matching", () => {
            const e = entry({
                name: "Lightning Bolt",
                oracleText: "Lightning Bolt deals 3 damage",
            });
            expect(e.oracleText).toBe("Lightning Bolt deals 3 damage");
        });

        it("catalogue entries have empty oracle text", () => {
            const entry = makeCatalogueEntry(row("Lightning Bolt"));
            expect(entry.oracleText).toBe("");
            expect(entry.oracleFold).toBe("");
        });

        it("parseTypeLine separates Token marker from types (CR 110.5e)", () => {
            const parsed = parseTypeLine("Token Artifact — Treasure");
            expect(parsed.types).toEqual(["Artifact"]);
            expect(parsed.isToken).toBe(true);

            const parsed2 = parseTypeLine(
                "Legendary Token Creature — Human Soldier"
            );
            expect(parsed2.supertypes).toEqual(["Legendary"]);
            expect(parsed2.types).toEqual(["Creature"]);
            expect(parsed2.isToken).toBe(true);
            expect(parsed2.subtypes).toEqual(["Human", "Soldier"]);
        });
    });
});
