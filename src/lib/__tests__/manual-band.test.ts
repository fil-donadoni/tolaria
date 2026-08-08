// Manual battlefield row classifier (`~/lib/manual-band`). Pure — reads a
// Full Catalogue type line (never a hydrated CardDefinition) plus an explicit
// lane override. See PRD #2162 / ADR 0080 § Battlefield row classification.
import { describe, it, expect } from "vitest";
import type { FullCatalogueRow } from "../fullCatalogue";
import {
    makeCatalogueRowLookup,
    manualBandOf,
    type ManualBandCard,
} from "../manual-band";

const GOBLIN_PRINT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Creature
const PLAINS_PRINT = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Land
const UNKNOWN_PRINT = "11111111-2222-3333-4444-555555555555"; // not in the catalogue

function row(overrides: Partial<FullCatalogueRow> = {}): FullCatalogueRow {
    return {
        name: "Goblin Guide",
        printId: GOBLIN_PRINT,
        typeLine: "Creature — Goblin",
        manaCost: "{R}",
        cmc: 1,
        colourIdentity: "R",
        set: "zen",
        rarity: "rare",
        nameFold: "goblin guide",
        available: true,
        ...overrides,
    };
}

const rows: FullCatalogueRow[] = [
    row(),
    row({
        name: "Plains",
        printId: PLAINS_PRINT,
        typeLine: "Basic Land — Plains",
        manaCost: "",
        cmc: 0,
        colourIdentity: "",
    }),
];

const lookupRow = makeCatalogueRowLookup(rows);

function card(overrides: Partial<ManualBandCard> = {}): ManualBandCard {
    return { card: { id: GOBLIN_PRINT }, ...overrides };
}

describe("manualBandOf", () => {
    it("puts a creature type line forward (creatures row)", () => {
        expect(manualBandOf(card(), lookupRow)).toBe("creatures");
    });

    it("puts a land type line back", () => {
        expect(
            manualBandOf(card({ card: { id: PLAINS_PRINT } }), lookupRow)
        ).toBe("back");
    });

    it("an explicit combat-row assignment overrides the inferred type — a land forced to combat", () => {
        expect(
            manualBandOf(
                card({ card: { id: PLAINS_PRINT }, lane: "combat" }),
                lookupRow
            )
        ).toBe("creatures");
    });

    it("an explicit main-row assignment overrides the inferred type — a creature forced to back", () => {
        expect(manualBandOf(card({ lane: "main" }), lookupRow)).toBe("back");
    });

    it("a card the catalogue cannot resolve falls to the back row", () => {
        expect(
            manualBandOf(card({ card: { id: UNKNOWN_PRINT } }), lookupRow)
        ).toBe("back");
    });

    // Manual-mode QA round 3, item 1 (the same root cause as the log's raw
    // ids): the catalogue asset keeps ONE representative printing per card,
    // but a Tabletop deck may hold any Scryfall printing. Such a card missed
    // the print-id lookup entirely and sat in the back row whatever it was.
    it("classifies a printing the catalogue never censused, by NAME", () => {
        expect(
            manualBandOf(
                card({ card: { id: UNKNOWN_PRINT }, name: "Goblin Guide" }),
                lookupRow
            )
        ).toBe("creatures");
    });
});

describe("makeCatalogueRowLookup", () => {
    it("resolves a print id to its row", () => {
        expect(lookupRow(GOBLIN_PRINT)?.typeLine).toBe("Creature — Goblin");
    });

    it("returns undefined for an id not in the rows", () => {
        expect(lookupRow(UNKNOWN_PRINT)).toBeUndefined();
    });

    it("degrades to an always-undefined lookup when rows are not loaded", () => {
        const empty = makeCatalogueRowLookup(undefined);
        expect(empty(GOBLIN_PRINT)).toBeUndefined();
    });

    it("falls back to an accent-folded, case-insensitive NAME match", () => {
        expect(lookupRow(UNKNOWN_PRINT, "goblin  guide")).toBeUndefined();
        expect(lookupRow(UNKNOWN_PRINT, "  GOBLIN GUIDE ")?.printId).toBe(
            GOBLIN_PRINT
        );
    });

    it("prefers the print id when it resolves — the name is only a fallback", () => {
        // A name that points at a DIFFERENT row must not win over an exact
        // print-id hit.
        expect(lookupRow(PLAINS_PRINT, "Goblin Guide")?.typeLine).toBe(
            "Basic Land — Plains"
        );
    });

    it("returns undefined for a name the catalogue does not carry", () => {
        expect(lookupRow(UNKNOWN_PRINT, "Not A Real Card")).toBeUndefined();
    });
});
