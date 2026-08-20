import { useDraggable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileCardTop } from "~/lib/card-layout";
import CardImage from "~/components/cards/card-image";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

/** The ONE deckbuilder card tile (issue #1581, re-homed here by #1632) — a
 *  single draggable + clickable card face rendered by EVERY zone surface:
 *  the Constructed Maindeck/Sideboard, the Limited build view's, and the
 *  draft-time Pool's. It replaced the forked tiles (`LimitedPoolCardTile` /
 *  `BuilderPile`'s inner `DraggableCard`); it lived under
 *  `components/limited/` until the draft Pool stopped having a column
 *  implementation of its own (#1632), which left the last file in that
 *  directory importing it with none.
 *
 *  Surface-specific concerns are props, not sibling components: the drag
 *  identity/payload (`dragId` / `dragData`), the gesture callbacks, and the
 *  tooltip. Every card renders as one member of an overlaid pile, so
 *  `stackIndex` is always set and the tile is `absolute`-positioned at its
 *  staggered `top`. */
export interface DeckCardTileProps {
    /** Registry Card ID — the card face to render. */
    cardId: string;
    /** dnd-kit draggable id (unique within the surface's DragDropProvider). */
    dragId: string;
    /** Drag payload the surface's `onDragEnd` reads to resolve the move. One
     *  shape across every surface: the `cardId`-keyed `CardDragData`, whose
     *  optional `pinKey` names the physical COPY being dragged (issue #1626 —
     *  the draft Pool's `poolIndex`, stringified). */
    dragData: CardDragData;
    /** Tooltip; also the queryable handle tests match (`Remove <name> …`). */
    title: string;
    /** Fired on a plain click — the primary tap gesture (move zone / toggle). */
    onClick: () => void;
    /** Fired on double-click. Issue #2584 binds it on every deckbuilder
     *  surface: with the per-card overlay buttons removed, a double-click is
     *  the POINTER path to the Inspect Overlay (the touch path being tap ->
     *  Peek Panel -> Inspect), so reading a card and setting it as Featured
     *  stay reachable with a mouse. */
    onDoubleClick?: () => void;
    /** Position in the overlaid pile — the tile renders `absolute` at the
     *  staggered `top` so only a sliver of each lower card shows and the
     *  topmost reads as the primary target. */
    stackIndex?: number;
    /** This card is the deck's Featured Card (PRD #589, issue #599) — draws
     *  the persistent indicator ring. Constructed only; the Limited builder
     *  and the draft Pool leave it unset. */
    isFeatured?: boolean;
    /** This card is the SELECTED card of its surface (issue #2584) — the one
     *  the Peek Panel is showing. Draws a selection ring; purely a cue, the
     *  panel itself is the parent's. */
    isSelected?: boolean;
    /** How many identical copies this tile stands for (issue #2584's MV rows).
     *  `undefined` or `1` renders no badge; `>1` renders a `×N` badge. The
     *  badge is `pointer-events-none` — it is a LABEL, not one of the overlay
     *  buttons this issue removed. */
    count?: number;
}

export default function DeckCardTile({
    cardId,
    dragId,
    dragData,
    title,
    onClick,
    onDoubleClick,
    stackIndex,
    isFeatured,
    isSelected,
    count,
}: DeckCardTileProps) {
    const { ref, isDragging } = useDraggable({ id: dragId, data: dragData });
    const stacked = stackIndex !== undefined;
    return (
        <div
            ref={ref}
            role="button"
            tabIndex={0}
            title={title}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            style={stacked ? { top: pileCardTop(stackIndex) } : undefined}
            className={cn(
                // `touch-pan-x`, not `touch-none` (issue #1633 bundled finding
                // — a quick swipe starting on a card must still scroll the
                // Column strip, ADR 0009). `useDeckDragSensors`' touch Delay
                // constraint (250ms) does its own gesture disambiguation: it
                // never calls `preventDefault` while waiting on the timer, and
                // dnd-kit's `PointerSensor.handleStart` only registers its OWN
                // `touchmove` `preventDefault` listener once the delay elapses
                // WITHOUT the finger having moved past its 10px tolerance
                // (`node_modules/@dnd-kit/dom`'s `DelayConstraint`/
                // `_PointerSensor.handleStart`) — so a fast swipe is never
                // seen as a drag at all and CSS is what decides whether the
                // browser is even ALLOWED to treat it as a scroll. `touch-none`
                // forecloses that at `touchstart`, before the JS delay ever
                // gets a chance — the same bug `board-hand-card.tsx`'s
                // `allowHorizontalPan` documents and fixes for the portrait
                // hand (issue #1994). `pan-x` (not `auto`) still blocks native
                // vertical panning starting on a card, which was never a
                // gesture this surface used.
                "group aspect-5/7 w-(--card-w) shrink-0 cursor-grab touch-pan-x select-none outline-none transition hover:-translate-y-0.5 hover:z-10",
                stacked ? "absolute left-0" : "relative",
                isDragging ? "opacity-30" : "",
                isSelected ? "z-10 -translate-y-0.5" : ""
            )}
        >
            {/* PRD #2405 / issue #2583: on an editing surface a 250ms touch hold is
                the DRAG (gesture model A), so the hold-preview is off — the
                card is read through the Peek Panel's Inspect CTA instead. */}
            <CardImage card={{ id: cardId }} holdPreview={false} />
            {/* A "removable" hover cue (parity with the pre-#1581 deckbuilder
                tile), keyed off the group so it only lights the hovered card. */}
            <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-danger-strong/70" />
            {isFeatured && (
                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-accent" />
            )}
            {isSelected && (
                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-accent-soft" />
            )}
            {/* Issue #2584: the `xN` badge of a collapsed MV row tile. A
                non-interactive LABEL — `pointer-events-none`, no role, no tab
                stop — so the AC "per-card overlay buttons are gone at every
                viewport" stays true with it on screen. */}
            {count !== undefined && count > 1 && (
                <span
                    data-card-count
                    className="pointer-events-none absolute right-0.5 bottom-0.5 rounded-sm border border-border-accent/70 bg-surface-base/90 px-1 text-[0.625rem] font-semibold leading-4 text-parchment"
                >
                    x{count}
                </span>
            )}
        </div>
    );
}
