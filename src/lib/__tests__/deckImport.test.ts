import { describe, it, expect } from "vitest";
import { getAllCardNames, getCardByName } from "@convex/cards";
import { parseDecklist } from "../deckImport";

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
