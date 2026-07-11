import { describe, it, expect } from "vitest";
import {
    getAllCardNames,
    getCardByName,
    resolveDeckCardMeta,
} from "@convex/cards";
import { PREMODERN_LEGAL_SETS } from "@convex/formats";
import type { DeckCard } from "~/types/game";
import { deckToText, parseDecklist } from "../deckImport";

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
