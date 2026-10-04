// The pure core of `cardPrints.tokenPrintsForGame` (ADR 0140 §4, issue #4120),
// unit-tested directly — this project has no Convex test harness (see
// `banlistSync.test.ts`'s header): which Card IDs the Game-load fetch reads
// definition Token Prints for, and which rows it ships. The definition
// printing (`printId === cardId`) has no `cardPrints` row (the sync skips it),
// so its Token Prints arrive as a synthetic row from `definitionTokenPrints`.
import { describe, it, expect } from "vitest";
import { cardIdsOf, toTokenPrintRows } from "../cardPrints";

const WASP = [{ name: "Wasp", tokenPrintId: "wasp-print" }];

describe("cardIdsOf", () => {
    it("takes a chosen printing's Card ID off its row", () => {
        expect(
            cardIdsOf(["odyssey"], [{ printId: "odyssey", cardId: "card" }])
        ).toEqual(["card"]);
    });

    it("takes an id with no row to BE a Card ID — an unpinned deck entry", () => {
        expect(cardIdsOf(["card"], [])).toEqual(["card"]);
    });

    it("names each Card ID once", () => {
        expect(
            cardIdsOf(
                ["odyssey", "ikoria", "card"],
                [
                    { printId: "odyssey", cardId: "card" },
                    { printId: "ikoria", cardId: "card" },
                ]
            )
        ).toEqual(["card"]);
    });
});

describe("toTokenPrintRows", () => {
    it("ships a `cardPrints` row that names tokens", () => {
        expect(
            toTokenPrintRows(
                [{ printId: "odyssey", cardId: "card", tokenPrints: WASP }],
                []
            )
        ).toEqual([{ printId: "odyssey", cardId: "card", tokenPrints: WASP }]);
    });

    it("keeps a tokenless chosen printing — it still points at its definition", () => {
        expect(
            toTokenPrintRows(
                [{ printId: "ikoria", cardId: "card", tokenPrints: [] }],
                []
            )
        ).toHaveLength(1);
    });

    it("drops a row that is its own Card ID and names no token", () => {
        expect(
            toTokenPrintRows(
                [{ printId: "card", cardId: "card", tokenPrints: [] }],
                []
            )
        ).toEqual([]);
    });

    it("adds the definition printing as a row keyed by its Card ID", () => {
        expect(
            toTokenPrintRows(
                [{ printId: "ikoria", cardId: "card", tokenPrints: [] }],
                [{ cardId: "card", tokenPrints: WASP }]
            )
        ).toContainEqual({
            printId: "card",
            cardId: "card",
            tokenPrints: WASP,
        });
    });

    it("an unpinned entry alone still gets its definition row", () => {
        expect(
            toTokenPrintRows([], [{ cardId: "card", tokenPrints: WASP }])
        ).toEqual([{ printId: "card", cardId: "card", tokenPrints: WASP }]);
    });

    it("never duplicates a printId already shipped from `cardPrints`", () => {
        const rows = toTokenPrintRows(
            [{ printId: "card", cardId: "card", tokenPrints: WASP }],
            [{ cardId: "card", tokenPrints: WASP }]
        );
        expect(rows).toHaveLength(1);
    });

    it("ships only the slim fields", () => {
        const [row] = toTokenPrintRows(
            [
                {
                    printId: "odyssey",
                    cardId: "card",
                    tokenPrints: WASP,
                    set: "ody",
                } as never,
            ],
            []
        );
        expect(Object.keys(row).sort()).toEqual([
            "cardId",
            "printId",
            "tokenPrints",
        ]);
    });
});
