import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
    fromSearchIndexWire,
    type SearchIndexWireRow,
} from "@convex/cards/searchIndex";
import type { FullCatalogueRow } from "~/lib/fullCatalogue";

// Issue #8754: with an active text query, name matches rank first, then
// partial name matches, then type-line / oracle-text matches; the selected
// sort orders WITHIN a rank. The type line is searched as text.

const h = vi.hoisted(() => ({ rows: undefined as unknown }));

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("~/lib/searchIndex", () => ({
    useSearchIndex: () => ({ rows: h.rows, error: null }),
}));

import { DEFAULT_FILTERS, useCardSearch } from "../useCardSearch";

const row = (
    id: string,
    name: string,
    types: string[],
    subtypes: string[],
    mv: number,
    oracle: string
): SearchIndexWireRow => [
    id,
    name,
    types,
    subtypes,
    [],
    ["R"],
    mv,
    oracle,
    "lea",
];

const WIRE: SearchIndexWireRow[] = [
    row("oracle", "Cheap Spell", ["Instant"], [], 1, "dragon tribute"),
    row("sub", "Cheap Lizard", ["Creature"], ["Dragon"], 2, ""),
    row("name", "Shivan Dragon", ["Creature"], ["Dragon"], 6, ""),
    row("name2", "Dragon Whelp", ["Creature"], ["Dragon"], 4, ""),
    row("both", "Dragon Creature", ["Sorcery"], [], 7, ""),
];

function search(
    text: string,
    extra: Partial<typeof DEFAULT_FILTERS> = {},
    catalogue?: FullCatalogueRow[],
    format?: "manual"
): string[] {
    h.rows = fromSearchIndexWire(WIRE);
    const { result } = renderHook(() =>
        useCardSearch(
            { ...DEFAULT_FILTERS, text, ...extra },
            format,
            catalogue ? { rows: catalogue, error: null } : undefined
        )
    );
    return result.current.entries.map((e) => e.cardId);
}

describe("text relevance rank (issue #8754)", () => {
    it("name match outranks cheaper oracle and subtype matches", () => {
        expect(search("dragon")).toEqual([
            "name2",
            "name",
            "both",
            "oracle",
            "sub",
        ]);
    });

    it("two tokens: all-name, then partial-name, then no-name", () => {
        expect(search("dragon creature")).toEqual([
            "both",
            "name2",
            "name",
            "sub",
        ]);
    });

    it("descending flips order within a rank, never the ranks", () => {
        expect(search("dragon", { sortDirection: "desc" })).toEqual([
            "both",
            "name",
            "name2",
            "sub",
            "oracle",
        ]);
    });

    it("type line alone matches", () => {
        expect(search("instant")).toEqual(["oracle"]);
    });

    it("Full Catalogue rows match by type line", () => {
        const cat: FullCatalogueRow[] = [
            {
                name: "Zzz Beast",
                printId: "c1",
                typeLine: "Creature — Wurmling",
                manaCost: "",
                cmc: 1,
                colourIdentity: "R",
                set: "lea",
                rarity: "common",
                nameFold: "zzz beast",
                available: true,
            },
        ];
        expect(search("wurmling", {}, cat, "manual")).toEqual(["c1"]);
    });

    it("no active text: order unchanged (mana value)", () => {
        expect(search("", { types: ["Creature"] })).toEqual([
            "sub",
            "name2",
            "name",
        ]);
    });
});
