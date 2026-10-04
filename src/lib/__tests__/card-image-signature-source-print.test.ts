// The memoised `<CardImage>` re-renders only when `cardImageSignature`
// changes, so a token's `sourcePrintId` — which picks its edition's Token
// Print (ADR 0140 §4, issue #4120) — must be part of it: two tokens that
// differ only in the printing that made them are different faces.
import { describe, it, expect } from "vitest";
import { cardImageSignature } from "../card-image-signature";
import type { CardInstance } from "~/types/game";

const base = {
    id: "token-1",
    isToken: true,
    card: { id: "token:Elephant|Creature|Elephant|G|3|3||" },
    controllerId: "p1",
    ownerId: "p1",
    zone: "battlefield",
    types: ["Creature"],
    subtypes: ["Elephant"],
    staticAbilities: [],
    isTapped: false,
} as CardInstance;

describe("cardImageSignature — a token's source printing", () => {
    it("differs between two tokens made by different printings", () => {
        expect(
            cardImageSignature({ ...base, sourcePrintId: "odyssey" })
        ).not.toBe(cardImageSignature({ ...base, sourcePrintId: "ikoria" }));
    });

    it("differs from a token with no recorded source", () => {
        expect(
            cardImageSignature({ ...base, sourcePrintId: "odyssey" })
        ).not.toBe(cardImageSignature(base));
    });
});
