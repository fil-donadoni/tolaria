import { useMemo } from "react";
import type { DeckCard } from "~/types/game";
import { groupDeckIntoPiles } from "./deckGrouping";
import ManaPile from "./mana-pile";

interface ManaPileViewProps {
    cards: DeckCard[];
}

export default function ManaPileView({ cards }: ManaPileViewProps) {
    const piles = useMemo(() => groupDeckIntoPiles(cards), [cards]);

    if (piles.length === 0) {
        return (
            <p className="text-sm text-text-muted">This deck has no cards.</p>
        );
    }

    return (
        <div className="overflow-x-auto whitespace-nowrap">
            {piles.map((pile, i) => (
                <div
                    key={pile.key}
                    className={`inline-block align-top whitespace-normal ${i > 0 ? "ml-2 md:ml-6" : ""}`}
                >
                    <ManaPile label={pile.label} cards={pile.cards} />
                </div>
            ))}
        </div>
    );
}
