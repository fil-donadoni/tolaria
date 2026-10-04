// The client's token-art resolver chain (ADR 0140 §4, issue #4120), tested per
// link: explicit `imagePrintId` → the Token Print with the token's name on the
// `sourcePrintId` row → the definition printing's Token Print → placeholder.
// The engine only stamps `sourcePrintId`; everything here is a pure lookup.
import { describe, it, expect } from "vitest";
import { tokenDefinitionId } from "@convex/cards";
import type { TokenSpec } from "@convex/cards/types";
import {
    EMPTY_TOKEN_PRINT_INDEX,
    indexTokenPrintRows,
    resolveArtPrintId,
    resolveTokenPrintId,
    type TokenPrintRow,
} from "../tokenArt";

const CARD = "card-definition-id";
const ODYSSEY = "odyssey-printing";
const IKORIA = "ikoria-printing";
const ODYSSEY_TOKEN = "odyssey-elephant";
const DEFAULT_TOKEN = "default-elephant";

const ROWS: TokenPrintRow[] = [
    // The definition printing: Scryfall's own pairing.
    {
        printId: CARD,
        cardId: CARD,
        tokenPrints: [{ name: "Elephant", tokenPrintId: DEFAULT_TOKEN }],
    },
    {
        printId: ODYSSEY,
        cardId: CARD,
        tokenPrints: [{ name: "Elephant", tokenPrintId: ODYSSEY_TOKEN }],
    },
    // An edition that printed no token of its own — only the mapping survives.
    { printId: IKORIA, cardId: CARD, tokenPrints: [] },
];
const INDEX = indexTokenPrintRows(ROWS);

describe("resolveTokenPrintId", () => {
    it("link 2: the token's name on the source printing's row — its edition's token", () => {
        expect(resolveTokenPrintId(ODYSSEY, "Elephant", INDEX)).toBe(
            ODYSSEY_TOKEN
        );
    });

    it("matches the token's name case-insensitively", () => {
        expect(resolveTokenPrintId(ODYSSEY, "elephant", INDEX)).toBe(
            ODYSSEY_TOKEN
        );
    });

    it("link 3: an edition that printed no such token falls back to the definition printing's", () => {
        expect(resolveTokenPrintId(IKORIA, "Elephant", INDEX)).toBe(
            DEFAULT_TOKEN
        );
    });

    it("an unpinned source (its Card ID) reads the definition printing's row directly", () => {
        expect(resolveTokenPrintId(CARD, "Elephant", INDEX)).toBe(
            DEFAULT_TOKEN
        );
    });

    it("a token named something the card never made resolves to nothing", () => {
        expect(resolveTokenPrintId(ODYSSEY, "Soldier", INDEX)).toBeUndefined();
    });

    it("link 4: no source, an unknown source or no rows at all resolves to nothing", () => {
        expect(resolveTokenPrintId(undefined, "Elephant", INDEX)).toBe(
            undefined
        );
        expect(resolveTokenPrintId("unknown", "Elephant", INDEX)).toBe(
            undefined
        );
        expect(
            resolveTokenPrintId(ODYSSEY, "Elephant", EMPTY_TOKEN_PRINT_INDEX)
        ).toBeUndefined();
    });

    it("a chosen printing whose definition row never loaded still reads its own", () => {
        const only = indexTokenPrintRows([ROWS[1]]);
        expect(resolveTokenPrintId(ODYSSEY, "Elephant", only)).toBe(
            ODYSSEY_TOKEN
        );
        expect(resolveTokenPrintId(IKORIA, "Elephant", only)).toBeUndefined();
    });
});

describe("resolveArtPrintId", () => {
    const spec: TokenSpec = {
        name: "Elephant",
        types: ["Creature"],
        subtypes: ["Elephant"],
        power: 3,
        toughness: 3,
        colors: ["G"],
    };
    const defId = tokenDefinitionId(spec);
    const PINNED = "09921372-126f-4c81-b6d8-ea50b1d0eb44";
    const pinnedDefId = tokenDefinitionId({ ...spec, imagePrintId: PINNED });

    it("link 1: the instance's own pin wins over everything", () => {
        expect(
            resolveArtPrintId(
                defId,
                { imagePrintId: "eternalize-frame", sourcePrintId: ODYSSEY },
                INDEX
            )
        ).toBe("eternalize-frame");
    });

    it("link 1: the token definition's pin (Treasure / Clue / Map) wins over the edition's", () => {
        expect(
            resolveArtPrintId(pinnedDefId, { sourcePrintId: ODYSSEY }, INDEX)
        ).toBe(PINNED);
    });

    it("links 2-3: an unpinned token resolves its edition's Token Print off `sourcePrintId`", () => {
        expect(
            resolveArtPrintId(defId, { sourcePrintId: ODYSSEY }, INDEX)
        ).toBe(ODYSSEY_TOKEN);
        expect(resolveArtPrintId(defId, { sourcePrintId: IKORIA }, INDEX)).toBe(
            DEFAULT_TOKEN
        );
    });

    it("link 4: no instance, no source, or no matching row is the placeholder (null)", () => {
        expect(resolveArtPrintId(defId, undefined, INDEX)).toBeNull();
        expect(resolveArtPrintId(defId, {}, INDEX)).toBeNull();
        expect(
            resolveArtPrintId(
                defId,
                { sourcePrintId: ODYSSEY },
                EMPTY_TOKEN_PRINT_INDEX
            )
        ).toBeNull();
    });

    it("a printed card is untouched: it resolves to its own id, rows or not", () => {
        const printed = "ce2d603a-3231-4a8c-bf39-1617586ea870";
        expect(resolveArtPrintId(printed, undefined, INDEX)).toBe(printed);
        expect(
            resolveArtPrintId(printed, { sourcePrintId: ODYSSEY }, INDEX)
        ).toBe(printed);
    });

    it("an unregistered definition never throws", () => {
        expect(
            resolveArtPrintId(
                "token:Nothing|x",
                { sourcePrintId: IKORIA },
                INDEX
            )
        ).toBeNull();
    });
});
