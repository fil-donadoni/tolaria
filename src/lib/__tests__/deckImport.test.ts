import { describe, it, expect } from "vitest";
import {
    getAllCardNames,
    getCardByName,
    resolveDeckCardMeta,
} from "@convex/cards";
import { PREMODERN_LEGAL_SETS } from "@convex/formats";
import { foldAccents } from "@convex/cards/textNormalize";
import type { DeckCard } from "~/types/game";
import { deckToText, parseDecklist } from "../deckImport";
import { makeCatalogueNameResolver } from "../fullCatalogue";

// Two real registry names to build fixtures from, so the test stays valid as
// the catalogue grows.
const NAMES = getAllCardNames();
const NAME_A = NAMES[0];
const NAME_B = NAMES[1];

describe("parseDecklist", () => {
    it("splits Deck and Sideboard sections and expands counts", () => {
        const text = [
            "Deck",
            `2 ${NAME_A}`,
            "",
            "Sideboard",
            `3 ${NAME_B}`,
        ].join("\n");

        const result = parseDecklist(text);

        expect(result.cards).toHaveLength(2);
        expect(result.cards.every((c) => c.cardName === NAME_A)).toBe(true);
        expect(result.cards[0].cardId).toBe(getCardByName(NAME_A).id);
        expect(result.sideboard).toHaveLength(3);
        expect(result.sideboard.every((c) => c.cardName === NAME_B)).toBe(true);
        expect(result.unresolved).toEqual([]);
    });

    it("defaults to the Maindeck when no section header precedes the cards", () => {
        const result = parseDecklist(`1 ${NAME_A}`);
        expect(result.cards).toHaveLength(1);
        expect(result.sideboard).toHaveLength(0);
    });

    it("resolves names case-insensitively and normalises to canonical name", () => {
        const result = parseDecklist(`1 ${NAME_A.toLowerCase()}`);
        expect(result.cards).toHaveLength(1);
        expect(result.cards[0].cardName).toBe(NAME_A);
    });

    it("accepts the '4x Name' count style", () => {
        const result = parseDecklist(`4x ${NAME_A}`);
        expect(result.cards).toHaveLength(4);
    });

    it("collects unknown card names as unresolved without aborting", () => {
        const text = [`1 ${NAME_A}`, "1 Definitely Not A Real Card 9000"].join(
            "\n"
        );

        const result = parseDecklist(text);

        expect(result.cards).toHaveLength(1);
        expect(result.unresolved).toEqual([
            "1 Definitely Not A Real Card 9000",
        ]);
    });

    it("collects malformed lines (no leading count) as unresolved", () => {
        const result = parseDecklist(`some stray text\n1 ${NAME_A}`);
        expect(result.cards).toHaveLength(1);
        expect(result.unresolved).toEqual(["some stray text"]);
    });

    it("ignores blank lines and tolerates CRLF and trailing header counts", () => {
        const text = `Deck\r\n1 ${NAME_A}\r\n\r\nSideboard (15)\r\n1 ${NAME_B}`;
        const result = parseDecklist(text);
        expect(result.cards).toHaveLength(1);
        expect(result.sideboard).toHaveLength(1);
        expect(result.unresolved).toEqual([]);
    });
});

describe("parseDecklist — format-aware printing selection", () => {
    // Counterspell's home printing is LEA (out of the Premodern pool), but it has
    // built reprints in Premodern-legal sets (4ed/ice/tmp/…). The importer must
    // pick the earliest legal one, never the illegal LEA original.
    const counterspell = getCardByName("Counterspell");

    it("keeps the home printing under an unrestricted format (Freeform default)", () => {
        const result = parseDecklist("1 Counterspell");
        expect(result.cards[0].cardId).toBe(counterspell.id);
        // LEA is the home printing — legal in Freeform.
        expect(resolveDeckCardMeta(result.cards[0].cardId)?.setCode).toBe(
            "lea"
        );
    });

    it("remaps to the earliest legal printing under a restricted format (Premodern)", () => {
        const result = parseDecklist("1 Counterspell", "premodern");
        const meta = resolveDeckCardMeta(result.cards[0].cardId);

        // Never the out-of-pool LEA original...
        expect(result.cards[0].cardId).not.toBe(counterspell.id);
        expect(meta?.setCode).not.toBe("lea");
        // ...and legal by construction: the printing's set is in the pool.
        expect(PREMODERN_LEGAL_SETS).toContain(meta?.setCode);
        // Earliest in the format's set order — 4th Edition heads the pool.
        expect(meta?.setCode).toBe("4ed");
        // Display name is preserved regardless of the picked printing.
        expect(result.cards[0].cardName).toBe("Counterspell");
    });
});

// Build a flat pile (one DeckCard per copy) from registry names, matching the
// builder's WorkingDeck shape.
function pile(...entries: [name: string, count: number][]): DeckCard[] {
    const cards: DeckCard[] = [];
    for (const [name, count] of entries) {
        const def = getCardByName(name);
        for (let i = 0; i < count; i++) {
            cards.push({ cardId: def.id, cardName: def.name });
        }
    }
    return cards;
}

// Tabletop (`manual`) imports resolve against the Full Catalogue too (ADR
// 0080): its pool is every printed card, so a pasted list of not-yet-
// implemented cards must import instead of landing in `unresolved`.
describe("parseDecklist — catalogue-backed names (Tabletop, ADR 0080)", () => {
    const UNIMPLEMENTED_ID = "0d16e8e0-31b2-4389-afd6-783c501f6fa0";
    const DFC_ID = "22222222-3333-4444-5555-666666666666";

    const resolveCatalogueName = makeCatalogueNameResolver([
        {
            name: "Ünimplemented Card",
            printId: UNIMPLEMENTED_ID,
            typeLine: "Creature — Zombie",
            manaCost: "{2}{B}",
            cmc: 3,
            colourIdentity: "B",
            set: "leg",
            rarity: "rare",
            nameFold: foldAccents("ünimplemented card"),
            available: false,
        },
        {
            name: "Front Face // Back Face",
            printId: DFC_ID,
            typeLine: "Creature — Werewolf",
            manaCost: "{1}{R}",
            cmc: 2,
            colourIdentity: "R",
            set: "isd",
            rarity: "rare",
            nameFold: "front face // back face",
            available: false,
        },
    ]);

    it("imports a catalogue-only card instead of skipping the line", () => {
        const result = parseDecklist(
            "2 Ünimplemented Card",
            "manual",
            resolveCatalogueName
        );
        expect(result.unresolved).toEqual([]);
        expect(result.cards).toHaveLength(2);
        expect(result.cards[0]).toEqual({
            cardId: UNIMPLEMENTED_ID,
            cardName: "Ünimplemented Card",
        });
    });

    it("matches accent-insensitively, like the builder search", () => {
        const result = parseDecklist(
            "1 unimplemented card",
            "manual",
            resolveCatalogueName
        );
        expect(result.unresolved).toEqual([]);
        expect(result.cards[0].cardId).toBe(UNIMPLEMENTED_ID);
    });

    it("matches a double-faced card by its front face alone (MTGA exports)", () => {
        const result = parseDecklist(
            "1 Front Face",
            "manual",
            resolveCatalogueName
        );
        expect(result.unresolved).toEqual([]);
        expect(result.cards[0]).toEqual({
            cardId: DFC_ID,
            cardName: "Front Face // Back Face",
        });
    });

    it("the registry still wins for an implemented card", () => {
        const result = parseDecklist(
            `1 ${NAME_A}`,
            "manual",
            resolveCatalogueName
        );
        expect(result.cards[0].cardId).toBe(getCardByName(NAME_A).id);
    });

    it("a name in neither the registry nor the catalogue stays unresolved", () => {
        const result = parseDecklist(
            "1 Not A Real Card At All",
            "manual",
            resolveCatalogueName
        );
        expect(result.cards).toEqual([]);
        expect(result.unresolved).toEqual(["1 Not A Real Card At All"]);
    });

    it("without a catalogue resolver the line is skipped, as before", () => {
        const result = parseDecklist("1 Ünimplemented Card", "manual");
        expect(result.cards).toEqual([]);
        expect(result.unresolved).toEqual(["1 Ünimplemented Card"]);
    });
});

describe("deckToText", () => {
    it("emits Deck and Sideboard headers with grouped counts", () => {
        const text = deckToText({
            cards: pile([NAME_A, 2]),
            sideboard: pile([NAME_B, 3]),
        });

        expect(text).toBe(
            ["Deck", `2 ${NAME_A}`, "", "Sideboard", `3 ${NAME_B}`].join("\n")
        );
    });

    it("omits the Sideboard section when the sideboard is empty", () => {
        const text = deckToText({ cards: pile([NAME_A, 1]), sideboard: [] });
        expect(text).toBe(["Deck", `1 ${NAME_A}`].join("\n"));
        expect(text).not.toContain("Sideboard");
    });

    it("round-trips through parseDecklist preserving sections and counts", () => {
        const deck = {
            cards: pile([NAME_A, 4], [NAME_B, 1]),
            sideboard: pile([NAME_B, 2]),
        };

        const reparsed = parseDecklist(deckToText(deck));

        expect(reparsed.unresolved).toEqual([]);
        expect(reparsed.cards).toEqual(deck.cards);
        expect(reparsed.sideboard).toEqual(deck.sideboard);
    });

    it("round-trips an empty sideboard cleanly", () => {
        const deck = { cards: pile([NAME_A, 2]), sideboard: [] };
        const reparsed = parseDecklist(deckToText(deck));
        expect(reparsed.cards).toEqual(deck.cards);
        expect(reparsed.sideboard).toEqual([]);
        expect(reparsed.unresolved).toEqual([]);
    });
});
