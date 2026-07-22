// `computeDeckColors` — shared between the catalogue-wide `DeckBuilder` and
// the Limited pool-scoped builder (`src/components/deckbuilder/pool-deck-builder-form.tsx`,
// issue #1111). Extracted on its second use (project convention) from
// `deck-builder.tsx`'s original inline helper. Uses real LEA registry ids
// (mirrors `src/lib/__tests__/deckTypes.test.ts`'s pattern).
import { describe, it, expect } from "vitest";
import { computeDeckColors } from "../deckColors";

const BOLT_LEA = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // red
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56"; // basic land, colorless

describe("computeDeckColors", () => {
    it("derives WUBRG-ordered colors from the deck's cards", () => {
        expect(
            computeDeckColors([
                { cardId: BOLT_LEA, cardName: "Lightning Bolt" },
            ])
        ).toEqual(["R"]);
    });

    it("a basic land contributes the color of mana it produces (getCardColorIdentity, deck-builder color identity)", () => {
        expect(
            computeDeckColors([{ cardId: MOUNTAIN, cardName: "Mountain" }])
        ).toEqual(["R"]);
    });

    it("an empty deck has no colors", () => {
        expect(computeDeckColors([])).toEqual([]);
    });

    it("silently ignores an unresolvable card id rather than throwing", () => {
        expect(() =>
            computeDeckColors([{ cardId: "not-a-real-card", cardName: "??" }])
        ).not.toThrow();
        expect(
            computeDeckColors([{ cardId: "not-a-real-card", cardName: "??" }])
        ).toEqual([]);
    });
});
