// `cardPrints` — pure core (ADR 0140, issue #4116). The project has no
// convex-test harness (see `convex/__tests__/banlistSync.test.ts`'s header),
// so `upsertBatch`'s handler is a thin wrapper and this file unit-tests its
// "skip an unchanged row" decision, `unchanged`, directly.

import { describe, expect, it } from "vitest";
import { unchanged, type CardPrintRowFields } from "../cardPrints";
import type { Doc } from "../_generated/dataModel";

function existingRow(
    overrides: Partial<CardPrintRowFields> = {}
): Doc<"cardPrints"> {
    return {
        _id: "fake-id" as Doc<"cardPrints">["_id"],
        _creationTime: 0,
        printId: "print-1",
        cardId: "card-1",
        set: "4ed",
        rarity: "uncommon",
        digital: false,
        promo: false,
        tokenPrints: [{ name: "Elemental", tokenPrintId: "token-1" }],
        ...overrides,
    } as Doc<"cardPrints">;
}

function row(overrides: Partial<CardPrintRowFields> = {}): CardPrintRowFields {
    return {
        cardId: "card-1",
        set: "4ed",
        rarity: "uncommon",
        digital: false,
        promo: false,
        tokenPrints: [{ name: "Elemental", tokenPrintId: "token-1" }],
        ...overrides,
    };
}

describe("unchanged — the sync never writes an unchanged row (PRD #4115)", () => {
    it("is true for an identical row", () => {
        expect(unchanged(existingRow(), row())).toBe(true);
    });

    it("is false when cardId differs", () => {
        expect(unchanged(existingRow(), row({ cardId: "card-2" }))).toBe(false);
    });

    it("is false when set differs", () => {
        expect(unchanged(existingRow(), row({ set: "leb" }))).toBe(false);
    });

    it("is false when rarity differs", () => {
        expect(unchanged(existingRow(), row({ rarity: "rare" }))).toBe(false);
    });

    it("is false when digital differs", () => {
        expect(unchanged(existingRow(), row({ digital: true }))).toBe(false);
    });

    it("is false when promo differs", () => {
        expect(unchanged(existingRow(), row({ promo: true }))).toBe(false);
    });

    it("is false when tokenPrints has a different length", () => {
        expect(
            unchanged(
                existingRow(),
                row({
                    tokenPrints: [
                        { name: "Elemental", tokenPrintId: "token-1" },
                        { name: "Spirit", tokenPrintId: "token-2" },
                    ],
                })
            )
        ).toBe(false);
    });

    it("is false when a tokenPrints entry differs at the same position", () => {
        expect(
            unchanged(
                existingRow(),
                row({
                    tokenPrints: [
                        { name: "Elemental", tokenPrintId: "token-DIFFERENT" },
                    ],
                })
            )
        ).toBe(false);
    });

    it("is false when tokenPrints carries the same entries in a different order (order-sensitive by design)", () => {
        const twoTokens = [
            { name: "Elemental", tokenPrintId: "token-1" },
            { name: "Spirit", tokenPrintId: "token-2" },
        ];
        expect(
            unchanged(
                existingRow({ tokenPrints: twoTokens }),
                row({ tokenPrints: [...twoTokens].reverse() })
            )
        ).toBe(false);
    });

    it("is true for two independently-built but field-identical tokenPrints arrays", () => {
        expect(
            unchanged(
                existingRow({
                    tokenPrints: [
                        { name: "Elemental", tokenPrintId: "token-1" },
                    ],
                }),
                row({
                    tokenPrints: [
                        { name: "Elemental", tokenPrintId: "token-1" },
                    ],
                })
            )
        ).toBe(true);
    });
});
