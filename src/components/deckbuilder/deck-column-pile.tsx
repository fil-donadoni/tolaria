import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileHeight } from "~/lib/card-layout";
import DeckCardTile, { type DeckCardTileProps } from "./deck-card-tile";

/** One tile in a Column pile, plus the stable React key its host assigns. */
export interface DeckPileTile extends DeckCardTileProps {
    key: string;
}

/**
 * The ONE Column pile (ADR 0075, issue #1622): a labelled, overlaid stack of
 * `DeckCardTile`s that is also a dnd-kit drop target. Every deckbuilder
 * surface renders its Columns through this — the Constructed Maindeck and
 * Sideboard, the Limited Maindeck and Sideboard, and (since issue #1632, via
 * the same `DeckZoneSurface` as all of those) the draft-time Pool.
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
    actions,
    hiddenWhenEmpty = false,
}: {
    label: string;
    /** dnd-kit droppable id — unique within the host's `DragDropProvider`. */
    dropId: string;
    /** False for a Column that renders but never accepts a drop. */
    droppable?: boolean;
    /** Debug/query handle mirroring the Column's own identity. */
    dataColumn?: string;
    tiles: DeckPileTile[];
    /** Column-management controls rendered in the header, in place of the card
     *  count (`DeckColumnActions`, issue #1626). A SLOT rather than a set of
     *  `onRename`/`onDelete` props: this component stays the dumb pile it was,
     *  and a surface that offers no column management (the reduced draft bar,
     *  ADR 0075 §6) passes nothing and renders exactly as before. */
    actions?: React.ReactNode;
    /** CSS-hide this Column below the `md` breakpoint while it holds no cards
     *  (issue #1633: "empty columns hidden" on narrow screens, so a swipe
     *  never scrolls past nothing). A CSS class rather than a render-time
     *  filter — the caller (`DeckZoneSurface`) still mounts and registers this
     *  Column's droppable at every viewport, which is what keeps it a legal
     *  DESKTOP drop target above `md` ("every column stays visible, as
     *  today"). The Catch-All is never passed `true` here — it always stays
     *  reachable as the guaranteed landing spot the AC calls for. */
    hiddenWhenEmpty?: boolean;
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
                hiddenWhenEmpty ? "hidden md:flex" : "flex",
                "w-(--card-w) shrink-0 snap-start md:snap-align-none flex-col gap-2 rounded-sm p-1 transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <div className="flex min-w-0 items-baseline justify-between gap-1 text-xs text-text-muted">
                <span className="truncate font-semibold">{label}</span>
                <span className="shrink-0 text-text-disabled">
                    {tiles.length}
                </span>
                {actions}
            </div>
            <div
                className="relative w-(--card-w)"
                style={{ height: pileHeight(tiles.length) }}
            >
                {tiles.map(({ key, ...tile }, idx) => (
                    <DeckCardTile key={key} {...tile} stackIndex={idx} />
                ))}
            </div>
        </div>
    );
}
