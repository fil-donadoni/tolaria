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
        <div className="flex items-start gap-2 md:gap-6 overflow-x-auto">
            {piles.map((pile) => (
                <ManaPile
                    key={pile.key}
                    label={pile.label}
                    cards={pile.cards}
                />
            ))}
        </div>
    );
}
