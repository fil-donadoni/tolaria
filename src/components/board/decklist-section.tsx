import { useMemo } from "react";
import type { DeckCard } from "~/types/game";

type DecklistSectionProps = {
    title: string;
    cards: DeckCard[];
};

type Row = { cardId: string; cardName: string; count: number };

/** Collapses a flat card list into one row per distinct card with a quantity,
 *  preserving first-seen order. */
function groupRows(cards: DeckCard[]): Row[] {
    const byId = new Map<string, Row>();
    for (const c of cards) {
        const existing = byId.get(c.cardId);
        if (existing) existing.count += 1;
        else byId.set(c.cardId, { ...c, count: 1 });
    }
    return [...byId.values()];
}

/** One read-only pile of the registered decklist (issue #2241): total count
 *  plus one row per distinct card with its quantity. No move affordances. */
export default function DecklistSection({
    title,
    cards,
}: DecklistSectionProps) {
    const rows = useMemo(() => groupRows(cards), [cards]);
    return (
        <section aria-label={title} className="flex flex-col min-w-0">
            <div className="px-1 pb-1 text-sm tracking-wide text-parchment">
                {title} ({cards.length})
            </div>
            {rows.length === 0 ? (
                <div className="px-1 py-2 text-xs text-text-muted">
                    No cards.
                </div>
            ) : (
                <ul className="flex flex-col gap-1">
                    {rows.map((row) => (
                        <li
                            key={row.cardId}
                            className="flex items-center gap-2 rounded-sm bg-surface-elevated px-2 py-1 text-xs text-text"
                        >
                            <span className="w-6 shrink-0 text-right text-text-muted">
                                {row.count}×
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                                {row.cardName}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
