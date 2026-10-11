import type { ReactNode } from "react";
import DeckColumnPile, { type DeckPileTile } from "./deck-column-pile";
import { splitBelowDropId } from "./deckZoneDrag";
import type { SplitGridColumn } from "./deckZoneSplit";

/** What the grid reads of a resolved column. */
export interface DeckSplitGridColumn {
    id: string;
    label: string;
    dropId: string;
    tiles: DeckPileTile[];
    actions?: ReactNode;
}

/**
 * The desktop "Split creatures" grid (issue #5399): ONE grid of columns, each
 * column's creature stack above a divider that runs across the whole grid and
 * its non-creature stack below. The creature band reserves the tallest stack
 * (`creatureSlots`), so the divider is one straight line. Both halves of a
 * column are drop targets resolving to that column (`splitBelowDropId`).
 */
export default function DeckSplitGrid<C extends DeckSplitGridColumn>({
    columns,
    creatureSlots,
    creatureCount,
    otherCount,
    droppable,
}: {
    columns: SplitGridColumn<C>[];
    creatureSlots: number;
    creatureCount: number;
    otherCount: number;
    droppable: boolean;
}) {
    return (
        <div
            data-split-grid
            className="grid w-max gap-x-6"
            style={{
                gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, var(--card-w))`,
            }}
        >
            {columns.map(({ column, creatures, others }) => (
                <div
                    key={`h-${column.id}`}
                    className="row-start-1 flex min-w-0 items-baseline justify-between gap-1 border-b border-border-subtle/40 pb-1 text-xs text-text-muted"
                >
                    <span className="truncate font-semibold">
                        {column.label}
                    </span>
                    <span className="shrink-0 text-text-disabled">
                        {creatures.length + others.length}
                    </span>
                    {column.actions}
                </div>
            ))}
            {columns.map(({ column, creatures }) => (
                <div key={`t-${column.id}`} className="row-start-2 pt-2">
                    <DeckColumnPile
                        label={column.label}
                        dropId={column.dropId}
                        droppable={droppable}
                        dataColumn={column.id}
                        tiles={creatures}
                        showHeader={false}
                        minSlots={creatureSlots}
                    />
                </div>
            ))}
            <div
                data-split-divider
                className="relative col-span-full row-start-3 my-2 flex h-6 items-center"
            >
                <span className="absolute inset-x-0 top-1/2 h-px bg-border-strong" />
                <span className="sticky left-0 z-10 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-surface-base px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                    <span>▲ Creatures {creatureCount}</span>
                    <span className="text-text-disabled">·</span>
                    <span>▼ Non-creatures {otherCount}</span>
                </span>
            </div>
            {columns.map(({ column, others }) => (
                <div key={`b-${column.id}`} className="row-start-4">
                    <DeckColumnPile
                        label={column.label}
                        dropId={splitBelowDropId(column.dropId)}
                        droppable={droppable}
                        dataColumn={column.id}
                        tiles={others}
                        showHeader={false}
                    />
                </div>
            ))}
        </div>
    );
}
