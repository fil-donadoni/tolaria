import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { SIDEBOARD_DROP_ID } from "./limitedDraftDrag";
import LimitedPoolCardTile from "./limited-pool-card-tile";
import type { PoolColumnEntry } from "./limitedPoolColumns";

/**
 * The narrower Sideboard column on the right of the Pool (ADR 0060, issue
 * #1247/#1248) — a single flat `useDroppable` pile, never bucketed by
 * Mana-Value.
 */
export default function LimitedPoolSideboard({
    entries,
    onToggleMain,
}: {
    entries: PoolColumnEntry[];
    onToggleMain: (poolIndex: number) => void;
}) {
    const { ref, isDropTarget } = useDroppable({ id: SIDEBOARD_DROP_ID });
    return (
        <div
            ref={ref}
            className={cn(
                "flex w-40 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border-subtle/30 p-2 transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <span className="font-semibold font-beleren tracking-wide text-parchment">
                Sideboard {entries.length}
            </span>
            {entries.length === 0 ? (
                <p className="text-sm text-text-muted">
                    Move a card here to park it out of your working deck.
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {entries.map((entry) => (
                        <LimitedPoolCardTile
                            key={entry.poolIndex}
                            poolIndex={entry.poolIndex}
                            card={entry.card}
                            sideboard
                            onToggleSideboard={() =>
                                onToggleMain(entry.poolIndex)
                            }
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
