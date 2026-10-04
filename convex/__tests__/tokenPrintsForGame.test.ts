// The pure core of `cardPrints.tokenPrintsForGame` (ADR 0140 §4, issue #4120),
// unit-tested directly — this project has no Convex test harness (see
// `banlistSync.test.ts`'s header): which definition printings the Game-load
// fetch must also read, and which rows it ships.
import { describe, it, expect } from "vitest";
import { definitionPrintIdsToRead, toTokenPrintRows } from "../cardPrints";

describe("definitionPrintIdsToRead", () => {
    it("names the definition printing of every chosen printing, once", () => {
        expect(
            definitionPrintIdsToRead([
                { printId: "odyssey", cardId: "card" },
                { printId: "ikoria", cardId: "card" },
                { printId: "other", cardId: "other-card" },
            ])
        ).toEqual(["card", "other-card"]);
    });

    it("skips a definition printing the deck already names", () => {
        expect(
            definitionPrintIdsToRead([
                { printId: "card", cardId: "card" },
                { printId: "odyssey", cardId: "card" },
            ])
        ).toEqual([]);
    });
});

describe("toTokenPrintRows", () => {
    const wasp = [{ name: "Wasp", tokenPrintId: "wasp-print" }];

    it("ships a row that names tokens", () => {
        expect(
            toTokenPrintRows([
                { printId: "card", cardId: "card", tokenPrints: wasp },
            ])
        ).toEqual([{ printId: "card", cardId: "card", tokenPrints: wasp }]);
    });

    it("keeps a tokenless chosen printing — it still points at its definition", () => {
        expect(
            toTokenPrintRows([
                { printId: "ikoria", cardId: "card", tokenPrints: [] },
            ])
        ).toHaveLength(1);
    });

    it("drops a row that is its own Card ID and names no token", () => {
        expect(
            toTokenPrintRows([
                { printId: "card", cardId: "card", tokenPrints: [] },
            ])
        ).toEqual([]);
    });

    it("ships only the slim fields", () => {
        const [row] = toTokenPrintRows([
            {
                printId: "card",
                cardId: "card",
                tokenPrints: wasp,
                set: "lea",
            } as never,
        ]);
        expect(Object.keys(row).sort()).toEqual([
            "cardId",
            "printId",
            "tokenPrints",
        ]);
    });
});
