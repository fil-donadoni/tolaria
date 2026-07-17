import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileHeight } from "~/lib/card-layout";
import type { PoolColumn } from "./limitedPoolColumns";
import { columnDropId } from "./limitedDraftDrag";
import LimitedPoolCardTile from "./limited-pool-card-tile";

/**
 * One fixed Mana-Value column (or the Lands column) of the draft-time Pool
 * (ADR 0060, issue #1248): a `useDroppable` drop target — the Lands column
 * registers too (a consistent visual affordance) but is never a valid
 * column-override TARGET, see `resolveDraftDragAction`'s doc comment — plus
 * every card currently resolved into it.
 */
export default function LimitedPoolPile({
    poolColumn,
    onToggleSideboard,
}: {
    poolColumn: PoolColumn;
    onToggleSideboard: (poolIndex: number) => void;
}) {
    const { ref, isDropTarget } = useDroppable({
        id: columnDropId(poolColumn.column),
    });
    return (
        <div
            ref={ref}
            className={cn(
                "flex w-(--card-w) shrink-0 flex-col gap-2 rounded-sm p-1 transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <div className="flex items-baseline justify-between gap-2 text-xs text-text-muted">
                <span className="font-semibold">{poolColumn.label}</span>
                <span className="text-text-disabled">
                    {poolColumn.entries.length}
                </span>
            </div>
            <div
                className="relative w-(--card-w)"
                style={{ height: pileHeight(poolColumn.entries.length) }}
            >
                {poolColumn.entries.map((entry, idx) => (
                    <LimitedPoolCardTile
                        key={entry.poolIndex}
                        poolIndex={entry.poolIndex}
                        card={entry.card}
                        sideboard={false}
                        onToggleSideboard={() =>
                            onToggleSideboard(entry.poolIndex)
                        }
                        stackIndex={idx}
                    />
                ))}
            </div>
        </div>
    );
}
