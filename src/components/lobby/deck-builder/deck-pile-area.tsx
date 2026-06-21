import { useMemo } from "react";
import type { DeckCard } from "~/types/game";
import { groupDeckIntoPiles } from "../deckGrouping";
import BuilderPile from "./builder-pile";

interface DeckPileAreaProps {
    /** Section heading, e.g. "Maindeck" / "Sideboard". */
    title: string;
    cards: DeckCard[];
    onRemove: (cardId: string) => void;
    /** Per-card move-action label ("→ Side" / "→ Main"); omitted = no action. */
    moveLabel?: string;
    onMove?: (cardId: string) => void;
    /** Optional count suffix, e.g. "/15" for the Sideboard limit. */
    countSuffix?: string;
    /** Optional soft-limit warning shown next to the count. */
    warning?: string | null;
    /** Message rendered when the section is empty. */
    emptyMessage: string;
}

export default function DeckPileArea({
    title,
    cards,
    onRemove,
    moveLabel,
    onMove,
    countSuffix,
    warning,
    emptyMessage,
}: DeckPileAreaProps) {
    const piles = useMemo(() => groupDeckIntoPiles(cards), [cards]);

    return (
        <section className="flex flex-col">
            <div className="flex items-baseline gap-2 px-3 pt-3 text-sm md:px-4">
                <span className="font-semibold font-beleren tracking-wide text-parchment">
                    {title} {cards.length}
                    {countSuffix ?? ""}
                </span>
                {warning && (
                    <span className="text-xs font-semibold text-danger-strong">
                        {warning}
                    </span>
                )}
            </div>
            {cards.length === 0 ? (
                <div className="flex items-center px-3 py-4 text-sm text-text-muted md:px-4">
                    {emptyMessage}
                </div>
            ) : (
                <div className="flex items-start gap-3 overflow-x-auto p-3 md:gap-6 md:p-4">
                    {piles.map((pile) => (
                        <BuilderPile
                            key={pile.key}
                            label={pile.label}
                            cards={pile.cards}
                            onRemove={onRemove}
                            moveLabel={moveLabel}
                            onMove={onMove}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
