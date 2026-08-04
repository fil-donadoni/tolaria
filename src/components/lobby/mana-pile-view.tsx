import { useMemo } from "react";
import type { DeckCard } from "~/types/game";
import { useDeckCardShapeResolver } from "~/lib/deckCardShape";
import { groupDeckIntoPiles } from "./deckGrouping";
import ManaPile from "./mana-pile";

interface ManaPileViewProps {
    cards: DeckCard[];
    /** True for a Tabletop (`manual`) deck, whose cards may be catalogue-only
     *  and unknown to the card registry (ADR 0080). Drives the catalogue-backed
     *  shape resolver — and, with it, whether the ~34k-row catalogue is fetched
     *  at all. */
    catalogueBacked?: boolean;
}

export default function ManaPileView({
    cards,
    catalogueBacked = false,
}: ManaPileViewProps) {
    const resolveShape = useDeckCardShapeResolver(catalogueBacked);
    const piles = useMemo(
        () => groupDeckIntoPiles(cards, resolveShape),
        [cards, resolveShape]
    );

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
