import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import DeckCardTile from "./deck-card-tile";
import type { DeckRowTile } from "./deckZoneRows";

/**
 * One Column drawn as a ROW (issue #2584, PRD #2405 slice 5, ADR 0101) — the
 * phone-portrait twin of `DeckColumnPile`.
 *
 * A phone held upright has ~390px of width and a whole screen of height, which
 * is the wrong way round for a strip of vertical piles: the pile the player
 * wants is off the right edge and the height it needs is off the bottom.
 * Rotating each Column into a horizontal row of its own puts every Column's
 * LABEL in one vertical scan and its cards on one axis the thumb already
 * swipes.
 *
 * Two things make the row safe to swipe:
 *
 *  - **`overscroll-x-contain`** — `overscroll-behavior-x: contain` stops a
 *    swipe that reaches the end of this row from chaining into the pane strip
 *    behind it. Without it, flicking through a row of 8 lands flips the whole
 *    pane to the Sideboard (the issue's "a row swipe never flips the pane").
 *  - **duplicates collapsed** (`collapseDuplicateTiles`) — one tile per
 *    distinct card with a `xN` badge, so a 4-of does not cost four swipes.
 *    The surviving tile is the FIRST copy, whole: tapping or dragging it acts
 *    on exactly one copy.
 *
 * The row is the SAME drop target as the pile it replaces — one Column, one
 * `zoneColumnDropId`, whichever arrangement is on screen.
 *
 * Deliberately renders no column-management controls (`DeckColumnActions`):
 * nine Columns x a controls button is nine more tap targets on the smallest
 * screen, and rename/delete are workbench gestures. They stay on the pile.
 */
export default function DeckMvRow({
    label,
    dropId,
    droppable = true,
    dataColumn,
    tiles,
    hiddenWhenEmpty = false,
}: {
    label: string;
    /** dnd-kit droppable id — the Column's, identical to the pile's. */
    dropId: string;
    droppable?: boolean;
    dataColumn?: string;
    tiles: DeckRowTile[];
    /** CSS-hide while empty, keeping the droppable mounted and registered —
     *  the same contract `DeckColumnPile` documents. */
    hiddenWhenEmpty?: boolean;
}) {
    const { ref, isDropTarget } = useDroppable({
        id: dropId,
        disabled: !droppable,
    });
    const total = tiles.reduce((sum, tile) => sum + tile.count, 0);
    return (
        <div
            ref={ref}
            data-column={dataColumn}
            data-deck-row
            className={cn(
                hiddenWhenEmpty && tiles.length === 0 ? "hidden" : "flex",
                "w-full shrink-0 flex-col gap-1 rounded-sm px-1 py-0.5 transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <div className="flex min-w-0 items-baseline justify-between gap-1 text-xs text-text-muted">
                <span className="truncate font-semibold">{label}</span>
                <span className="shrink-0 text-text-disabled">{total}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1">
                {tiles.map(({ key, ...tile }) => (
                    <DeckCardTile key={key} {...tile} />
                ))}
            </div>
        </div>
    );
}
