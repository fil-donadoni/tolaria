import { useCallback, useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import { resolvePoolPlacements } from "@convex/limited/poolArrangement";
import { useLimitedEventMutations } from "~/hooks/useLimitedEvent";
import { groupPoolIntoColumns, sideboardEntries } from "./limitedPoolColumns";
import PoolColumnPile, { type PoolPileTile } from "./pool-column-pile";
import PoolSideboardPile from "./pool-sideboard-pile";
import type { PoolDragData } from "./limitedDraftDrag";

/**
 * The draft-time Pool (ADR 0060, issues #1247/#1248): fixed Mana-Value
 * columns (always rendered, even empty — every column is a valid drop
 * target for a manual override) plus a narrower Sideboard column on the
 * right. "The draft-time Pool IS the working deck": every card defaults
 * into the Maindeck the instant it's picked, and moving a card (drag,
 * double-click, or click) persists server-side on the seat's Pool
 * Arrangement so it "carries unchanged into deckbuild" once the draft
 * finishes (`pool-deck-builder-form.tsx` seeds its working deck from the
 * SAME `resolvePoolPlacements`/`splitPoolByArrangement`).
 *
 * Renders the SHARED Pool surface components (`PoolColumnPile`,
 * `PoolSideboardPile`, `PoolCardTile` — issue #1581) the limited deckbuilder
 * also mounts, so a layout/interaction change lands on both phases by
 * construction. The phase-specific concerns stay here: pick-time persistence
 * (`setPoolArrangementEntry` per move, not a debounced deck autosave) and the
 * `poolIndex`-keyed drag payloads.
 *
 * Column-level and Sideboard-level DRAG targets (`useDroppable`, wired by the
 * shared piles) rely on being rendered under an ANCESTOR `DragDropProvider` —
 * this component renders no provider of its own so it can share ONE dnd
 * context with the Booster above it (`limited-draft-table.tsx` owns the
 * provider so a Booster card can be dragged straight into a Pool column or the
 * Sideboard).
 */
export default function LimitedDraftPool({
    eventId,
    pool,
    arrangement,
}: {
    eventId: Id<"limitedEvents">;
    pool: LimitedPoolCard[];
    arrangement: PoolArrangementEntry[] | null;
}) {
    const { setPoolArrangementEntry } = useLimitedEventMutations();

    const placements = useMemo(
        () => resolvePoolPlacements(pool, arrangement ?? undefined),
        [pool, arrangement]
    );
    const columns = useMemo(
        () => groupPoolIntoColumns(placements),
        [placements]
    );
    const sideboard = useMemo(() => sideboardEntries(placements), [placements]);
    const mainCount = pool.length - sideboard.length;

    const toggleSideboard = useCallback(
        (poolIndex: number, toSideboard: boolean) => {
            void setPoolArrangementEntry({
                eventId,
                poolIndex,
                sideboard: toSideboard,
            });
        },
        [setPoolArrangementEntry, eventId]
    );

    const columnTiles = useMemo(
        () =>
            columns.map((column) => ({
                key: column.key,
                label: column.label,
                column: column.column,
                tiles: column.entries.map(
                    (entry): PoolPileTile => ({
                        key: String(entry.poolIndex),
                        cardId: entry.card.cardId,
                        dragId: `pool-${entry.poolIndex}`,
                        dragData: {
                            kind: "pool",
                            poolIndex: entry.poolIndex,
                            cardId: entry.card.cardId,
                            cardName: entry.card.cardName,
                        } satisfies PoolDragData,
                        title: `Remove ${entry.card.cardName} (double-click, drag, or click)`,
                        onClick: () => toggleSideboard(entry.poolIndex, true),
                        onDoubleClick: () =>
                            toggleSideboard(entry.poolIndex, true),
                    })
                ),
            })),
        [columns, toggleSideboard]
    );

    const sideboardTiles = useMemo(
        (): PoolPileTile[] =>
            sideboard.map((entry) => ({
                key: String(entry.poolIndex),
                cardId: entry.card.cardId,
                dragId: `pool-${entry.poolIndex}`,
                dragData: {
                    kind: "pool",
                    poolIndex: entry.poolIndex,
                    cardId: entry.card.cardId,
                    cardName: entry.card.cardName,
                } satisfies PoolDragData,
                title: `Remove ${entry.card.cardName} from the Sideboard (double-click, drag, or click)`,
                onClick: () => toggleSideboard(entry.poolIndex, false),
                onDoubleClick: () => toggleSideboard(entry.poolIndex, false),
            })),
        [sideboard, toggleSideboard]
    );

    if (pool.length === 0) {
        return (
            <p className="text-sm text-text-muted">
                No Pool has been generated for your seat yet.
            </p>
        );
    }

    return (
        <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-1 flex-col overflow-hidden">
                <span className="mb-2 font-semibold font-beleren tracking-wide text-parchment">
                    Pool {mainCount}
                </span>
                <div className="flex flex-1 items-start gap-3 overflow-auto">
                    {columnTiles.map((column) => (
                        <PoolColumnPile
                            key={column.key}
                            label={column.label}
                            column={column.column}
                            tiles={column.tiles}
                        />
                    ))}
                </div>
            </div>
            <PoolSideboardPile
                title="Sideboard"
                count={sideboardTiles.length}
                groups={[{ key: "side", label: "", tiles: sideboardTiles }]}
                emptyMessage="Move a card here to park it out of your working deck."
                className="w-40 shrink-0 overflow-y-auto border-l border-border-subtle/30 p-2"
            />
        </div>
    );
}
