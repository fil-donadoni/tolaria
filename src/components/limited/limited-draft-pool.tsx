import { useCallback, useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import { resolvePoolPlacements } from "@convex/limited/poolArrangement";
import { useLimitedEventMutations } from "~/hooks/useLimitedEvent";
import { groupPoolIntoColumns, sideboardEntries } from "./limitedPoolColumns";
import LimitedPoolPile from "./limited-pool-pile";
import LimitedPoolSideboard from "./limited-pool-sideboard";

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
 * Column-level and Sideboard-level DRAG targets (`useDroppable`, wired by
 * `LimitedPoolPile`/`LimitedPoolSideboard`) rely on being rendered under an
 * ANCESTOR `DragDropProvider` — this component renders no provider of its
 * own so it can share ONE dnd context with the Booster above it
 * (`limited-draft-table.tsx` owns the provider so a Booster card can be
 * dragged straight into a Pool column or the Sideboard).
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
                    {columns.map((column) => (
                        <LimitedPoolPile
                            key={column.key}
                            poolColumn={column}
                            onToggleSideboard={(poolIndex) =>
                                toggleSideboard(poolIndex, true)
                            }
                        />
                    ))}
                </div>
            </div>
            <LimitedPoolSideboard
                entries={sideboard}
                onToggleMain={(poolIndex) => toggleSideboard(poolIndex, false)}
            />
        </div>
    );
}
