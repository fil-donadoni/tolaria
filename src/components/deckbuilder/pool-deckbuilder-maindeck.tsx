import { useMemo } from "react";
import type { DeckCard } from "~/types/game";
import { groupDeckIntoFixedColumns } from "~/components/lobby/deckGrouping";
import PoolDeckbuilderColumn from "./pool-deckbuilder-column";

/**
 * The limited deckbuilder's Maindeck (issue #1575): the SAME fixed
 * Mana-Value column set as the draft Pool (`limitedPoolColumns.ts` /
 * `groupDeckIntoFixedColumns`), every column an individual drop target so a
 * card can be dragged between columns to record a manual override. Each
 * card's column honours the seat's Pool Arrangement (`columnOf`) — the manual
 * arrangement built during the draft carries straight over here (ADR 0060).
 */
export default function PoolDeckbuilderMaindeck({
    title,
    cards,
    columnOf,
    onRemove,
    emptyMessage,
    headerRight,
}: {
    title: string;
    cards: DeckCard[];
    /** Manual Mana-Value column override for a Card ID (the seat's Pool
     *  Arrangement), or `undefined` for the card's auto column. */
    columnOf: (cardId: string) => number | "lands" | undefined;
    onRemove: (cardId: string) => void;
    emptyMessage: string;
    headerRight?: React.ReactNode;
}) {
    const columns = useMemo(
        () => groupDeckIntoFixedColumns(cards, columnOf),
        [cards, columnOf]
    );

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-baseline gap-2 px-3 pt-3 text-sm md:px-4">
                <span className="font-semibold font-beleren tracking-wide text-parchment">
                    {title} {cards.length}
                </span>
                {headerRight && (
                    <div className="ml-auto self-center">{headerRight}</div>
                )}
            </div>
            {cards.length === 0 && (
                <div className="px-3 pt-2 text-sm text-text-muted md:px-4">
                    {emptyMessage}
                </div>
            )}
            {/* Columns always render — even with an empty Maindeck — so every
                column stays a drop target a Sideboard card can be dragged
                into (mirrors the draft Pool's always-present columns). */}
            <div className="flex flex-1 items-start gap-3 overflow-auto p-3 md:gap-6 md:p-4">
                {columns.map((column) => (
                    <PoolDeckbuilderColumn
                        key={column.key}
                        column={column}
                        onRemove={onRemove}
                    />
                ))}
            </div>
        </div>
    );
}
