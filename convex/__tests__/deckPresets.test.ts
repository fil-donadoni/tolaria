import { describe, it, expect } from "vitest";
import { PRESET_DECKS } from "../deckPresets";
import { getCardById } from "../cards";

describe("PRESET_DECKS", () => {
    it.each(PRESET_DECKS.map((d) => [d.name, d]))(
        "%s has 40 cards",
        (_name, deck) => {
            expect(deck.cards).toHaveLength(40);
        }
    );

    it.each(PRESET_DECKS.map((d) => [d.name, d]))(
        "%s only contains cards present in the registry",
        (_name, deck) => {
            for (const { cardId } of deck.cards) {
                expect(() => getCardById(cardId)).not.toThrow();
            }
        }
    );

    it.each(PRESET_DECKS.map((d) => [d.name, d]))(
        "%s cardName matches the registry name",
        (_name, deck) => {
            for (const { cardId, cardName } of deck.cards) {
                expect(getCardById(cardId).name).toBe(cardName);
            }
        }
    );
});
