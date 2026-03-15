import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { CardInstance, DeckCard } from "~/types/game";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export const times = (
    n: number,
    cardId: string,
    cardName: string
): DeckCard[] => Array.from({ length: n }, () => ({ cardId, cardName }));

/** Groups deck cards by cardId for display (e.g. "4x Lightning Bolt"). */
export const groupDeckCards = (cards: DeckCard[]) => {
    const grouped = new Map<
        string,
        { cardId: string; cardName: string; quantity: number }
    >();

    for (const card of cards) {
        const existing = grouped.get(card.cardId);
        if (existing) {
            existing.quantity++;
        } else {
            grouped.set(card.cardId, {
                cardId: card.cardId,
                cardName: card.cardName,
                quantity: 1,
            });
        }
    }

    return [...grouped.values()];
};

export const shuffleCards = (cards: CardInstance[]) => {
    const arrayCopy = [...cards];

    for (let i = arrayCopy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [arrayCopy[i], arrayCopy[j]] = [arrayCopy[j], arrayCopy[i]];
    }

    return arrayCopy;
};
