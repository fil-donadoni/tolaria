import { getDefinition } from "@convex/cards";
import { manaValue } from "@convex/gre/constants";
import type { DeckCard } from "~/types/game";

export interface DeckPileGroup {
    key: string;
    label: string;
    cards: DeckCard[];
}

/**
 * Groups deck cards into vertical piles for the "mana pile" view.
 * Lands go in a dedicated first pile; remaining cards are bucketed by mana value.
 * Buckets are dynamic — only MV values present in the deck appear.
 */
export function groupDeckIntoPiles(cards: DeckCard[]): DeckPileGroup[] {
    const lands: DeckCard[] = [];
    const byMv = new Map<number, DeckCard[]>();

    for (const card of cards) {
        const def = getDefinition(card.cardId);
        if (def.types.includes("Land")) {
            lands.push(card);
            continue;
        }
        const mv = manaValue(def.manaCost);
        const bucket = byMv.get(mv);
        if (bucket) bucket.push(card);
        else byMv.set(mv, [card]);
    }

    const sortInPlace = (arr: DeckCard[]) =>
        arr.sort(
            (a, b) =>
                a.cardName.localeCompare(b.cardName) ||
                a.cardId.localeCompare(b.cardId)
        );

    const piles: DeckPileGroup[] = [];
    if (lands.length > 0) {
        piles.push({ key: "lands", label: "Lands", cards: sortInPlace(lands) });
    }
    const mvs = [...byMv.keys()].sort((a, b) => a - b);
    for (const mv of mvs) {
        piles.push({
            key: `mv-${mv}`,
            label: `MV ${mv}`,
            cards: sortInPlace(byMv.get(mv)!),
        });
    }
    return piles;
}
