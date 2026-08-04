// The deck-card SHAPE seam (`~/lib/deckCardShape`). Every deck-list surface
// resolves a `DeckCard` through it instead of `getDefinition`, because a
// Tabletop (`manual`) deck's pool is the whole Full Catalogue (ADR 0080) — its
// card ids are Scryfall print UUIDs the GRE registry has never heard of, and a
// hard registry read throws `Card not found: <uuid>` and takes the view down.
import { describe, it, expect } from "vitest";
import type { FullCatalogueRow } from "../fullCatalogue";
import {
    catalogueRowShape,
    makeDeckCardShapeResolver,
    registryDeckCardShape,
} from "../deckCardShape";

const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // red, MV 1
const PLAINS_LEA = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // basic land
const UNIMPLEMENTED = "0d16e8e0-31b2-4389-afd6-783c501f6fa0";

function row(overrides: Partial<FullCatalogueRow> = {}): FullCatalogueRow {
    return {
        name: "Unimplemented Card",
        printId: UNIMPLEMENTED,
        typeLine: "Creature — Zombie",
        manaCost: "{2}{B}",
        cmc: 3,
        colourIdentity: "B",
        set: "leg",
        rarity: "rare",
        nameFold: "unimplemented card",
        available: false,
        ...overrides,
    };
}

describe("registryDeckCardShape", () => {
    it("reads an implemented card's shape off the registry", () => {
        expect(registryDeckCardShape(BOLT_LEA)).toEqual({
            isLand: false,
            manaValue: 1,
            colors: ["R"],
        });
    });

    it("marks a land", () => {
        expect(registryDeckCardShape(PLAINS_LEA)?.isLand).toBe(true);
    });

    it("returns null — never throws — for an id the registry lacks", () => {
        expect(() => registryDeckCardShape(UNIMPLEMENTED)).not.toThrow();
        expect(registryDeckCardShape(UNIMPLEMENTED)).toBeNull();
    });
});

describe("catalogueRowShape", () => {
    it("derives the shape from the printed type line, CMC and colour identity", () => {
        expect(catalogueRowShape(row())).toEqual({
            isLand: false,
            manaValue: 3,
            colors: ["B"],
        });
    });

    it("recognises a land off the type line, supertypes and all", () => {
        expect(
            catalogueRowShape(
                row({ typeLine: "Legendary Land — Urza's Tower", cmc: 0 })
            ).isLand
        ).toBe(true);
    });

    it("a colourless card has no colours", () => {
        expect(catalogueRowShape(row({ colourIdentity: "" })).colors).toEqual(
            []
        );
    });
});

describe("makeDeckCardShapeResolver", () => {
    it("resolves a catalogue-only card the registry cannot", () => {
        const resolve = makeDeckCardShapeResolver([row()]);
        expect(resolve(UNIMPLEMENTED)).toEqual({
            isLand: false,
            manaValue: 3,
            colors: ["B"],
        });
    });

    it("the registry wins for an implemented card", () => {
        // A deliberately wrong catalogue row for Lightning Bolt: the resolver
        // must not consult it while the registry knows the card.
        const resolve = makeDeckCardShapeResolver([
            row({ printId: BOLT_LEA, cmc: 9, colourIdentity: "G" }),
        ]);
        expect(resolve(BOLT_LEA)).toEqual({
            isLand: false,
            manaValue: 1,
            colors: ["R"],
        });
    });

    it("returns null for a card in neither the registry nor the catalogue", () => {
        const resolve = makeDeckCardShapeResolver([row()]);
        expect(resolve("11111111-2222-3333-4444-555555555555")).toBeNull();
    });

    it("falls back to registry-only resolution when the catalogue hasn't loaded", () => {
        const resolve = makeDeckCardShapeResolver(undefined);
        expect(resolve(BOLT_LEA)?.manaValue).toBe(1);
        expect(resolve(UNIMPLEMENTED)).toBeNull();
    });
});
