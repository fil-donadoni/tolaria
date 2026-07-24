import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileHeight } from "~/lib/card-layout";
import { columnDropId } from "./limitedDraftDrag";
import PoolCardTile, { type PoolCardTileProps } from "./pool-card-tile";

/** One tile in a column, plus the stable React key its host assigns. */
export interface PoolPileTile extends PoolCardTileProps {
    key: string;
}

/** The ONE fixed Mana-Value column (or Lands column) shared by BOTH the draft
 *  Pool and the limited deckbuilder Maindeck (issue #1581), replacing the two
 *  forked piles (`LimitedPoolPile` / `PoolDeckbuilderColumn` + `BuilderPile`).
 *  A `useDroppable` drop target keyed by the shared `columnDropId` — every
 *  column is a manual-override target, even when empty — wrapping an overlaid
 *  deckbuilder-style pile of `PoolCardTile`s. Must render under an ancestor
 *  `DragDropProvider` (each host owns its own).
 */
export default function PoolColumnPile({
    label,
    column,
    tiles,
}: {
    label: string;
    column: number | "lands";
    tiles: PoolPileTile[];
}) {
    const { ref, isDropTarget } = useDroppable({ id: columnDropId(column) });
    return (
        <div
            ref={ref}
            data-column={String(column)}
            className={cn(
                "flex w-(--card-w) shrink-0 flex-col gap-2 rounded-sm p-1 transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <div className="flex items-baseline justify-between gap-2 text-xs text-text-muted">
                <span className="font-semibold">{label}</span>
                <span className="text-text-disabled">{tiles.length}</span>
            </div>
            <div
                className="relative w-(--card-w)"
                style={{ height: pileHeight(tiles.length) }}
            >
                {tiles.map(({ key, ...tile }, idx) => (
                    <PoolCardTile key={key} {...tile} stackIndex={idx} />
                ))}
            </div>
        </div>
    );
}
