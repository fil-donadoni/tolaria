import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileHeight } from "~/lib/card-layout";
import PoolCardTile, {
    type PoolCardTileProps,
} from "~/components/limited/pool-card-tile";

/** One tile in a Column pile, plus the stable React key its host assigns. */
export interface DeckPileTile extends PoolCardTileProps {
    key: string;
}

/**
 * The ONE Column pile (ADR 0075, issue #1622): a labelled, overlaid stack of
 * `PoolCardTile`s that is also a dnd-kit drop target. Every deckbuilder
 * surface renders its Columns through this — the Constructed Maindeck and
 * Sideboard, the Limited Maindeck and Sideboard, and (via `PoolColumnPile`)
 * the draft-time Pool.
 *
 * `droppable: false` keeps the pile registered but inert, which is how the
 * Sideboard works: the whole PANE is the drop target there (a card dropped in
 * it leaves the deck, no Pin recorded), so its Columns must not compete for
 * the drop. A registered-but-disabled droppable is deliberate — dnd-kit needs
 * a stable id per mounted droppable, and toggling registration on and off
 * would churn the registry on every render.
 *
 * Must render under an ancestor `DragDropProvider` (each host owns its own).
 */
export default function DeckColumnPile({
    label,
    dropId,
    droppable = true,
    dataColumn,
    tiles,
}: {
    label: string;
    /** dnd-kit droppable id — unique within the host's `DragDropProvider`. */
    dropId: string;
    /** False for a Column that renders but never accepts a drop. */
    droppable?: boolean;
    /** Debug/query handle mirroring the Column's own identity. */
    dataColumn?: string;
    tiles: DeckPileTile[];
}) {
    const { ref, isDropTarget } = useDroppable({
        id: dropId,
        disabled: !droppable,
    });
    return (
        <div
            ref={ref}
            data-column={dataColumn}
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
