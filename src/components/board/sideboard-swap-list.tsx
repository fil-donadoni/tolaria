import { useMemo } from "react";
import type { DeckCard } from "~/types/game";

type SideboardSwapListProps = {
    /** Section heading, e.g. "Maindeck" / "Sideboard". */
    title: string;
    cards: DeckCard[];
    /** Per-row action label ("→ Side" / "→ Main"). */
    moveLabel: string;
    onMove: (cardId: string) => void;
    /** Optional count suffix shown after the count (e.g. " (locked)"). */
    countSuffix?: string;
    disabled?: boolean;
    emptyMessage: string;
};

type Row = { cardId: string; cardName: string; count: number };

/** Collapses a flat card list into one row per distinct card with a quantity,
 *  preserving first-seen order. Sideboarding moves a single copy at a time. */
function groupRows(cards: DeckCard[]): Row[] {
    const order: string[] = [];
    const byId = new Map<string, Row>();
    for (const c of cards) {
        const existing = byId.get(c.cardId);
        if (existing) existing.count += 1;
        else {
            order.push(c.cardId);
            byId.set(c.cardId, {
                cardId: c.cardId,
                cardName: c.cardName,
                count: 1,
            });
        }
    }
    return order.map((id) => byId.get(id)!);
}

/** One pile of the between-Games Sideboarding editor (issue #395). Lists the
 *  cards in a section with a per-row button that moves a single copy to the
 *  other section. Purely presentational — swap state lives in the parent. */
export default function SideboardSwapList({
    title,
    cards,
    moveLabel,
    onMove,
    countSuffix,
    disabled,
    emptyMessage,
}: SideboardSwapListProps) {
    const rows = useMemo(() => groupRows(cards), [cards]);

    return (
        <section className="flex flex-col min-w-0 flex-1">
            <div className="px-1 pb-1 text-sm font-beleren tracking-wide text-parchment">
                {title} {cards.length}
                {countSuffix ?? ""}
            </div>
            {rows.length === 0 ? (
                <div className="px-1 py-2 text-xs text-text-muted">
                    {emptyMessage}
                </div>
            ) : (
                <ul className="flex flex-col gap-1 overflow-y-auto max-h-64 pr-1">
                    {rows.map((row) => (
                        <li
                            key={row.cardId}
                            className="flex items-center justify-between gap-2 rounded-sm bg-zinc-800/40 px-2 py-1 text-xs text-zinc-200"
                        >
                            <span className="truncate">
                                {row.count > 1 ? `${row.count}× ` : ""}
                                {row.cardName}
                            </span>
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onMove(row.cardId)}
                                className="shrink-0 rounded-sm border border-amber-500/40 px-1.5 py-0.5 text-amber-200 hover:bg-amber-600/20 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {moveLabel}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
