import { useMemo } from "react";
import type { DeckCard } from "~/types/game";
import { groupDeckIntoPiles } from "../deckGrouping";
import BuilderPile from "./builder-pile";

interface DeckPileAreaProps {
    cards: DeckCard[];
    onRemove: (cardId: string) => void;
}

export default function DeckPileArea({ cards, onRemove }: DeckPileAreaProps) {
    const piles = useMemo(() => groupDeckIntoPiles(cards), [cards]);

    if (cards.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-white/40">
                Click cards above to add them to your deck.
            </div>
        );
    }

    return (
        <div className="flex items-start gap-6 overflow-x-auto p-4">
            {piles.map((pile) => (
                <BuilderPile
                    key={pile.key}
                    label={pile.label}
                    cards={pile.cards}
                    onRemove={onRemove}
                />
            ))}
        </div>
    );
}
