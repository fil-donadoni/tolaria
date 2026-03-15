import type { CardDefinition } from "./types";
import * as lea from "./sets/lea";

const allCards: CardDefinition[] = [...Object.values(lea)];

const registry = new Map<string, CardDefinition>(
    allCards.map((card) => [card.id, card])
);

export const getCardById = (cardId: string): CardDefinition => {
    const card = registry.get(cardId);
    if (!card) {
        throw new Error(`Card not found: ${cardId}`);
    }
    return card;
};
