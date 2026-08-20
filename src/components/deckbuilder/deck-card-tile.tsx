import { useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { DOUBLE_CLICK_WINDOW_MS } from "~/lib/gesture/activation";
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
    /** The single-click action MOVES the card (removes a copy, sends it to the
     *  other zone) rather than merely SELECTING it — so it must not run for
     *  the first click of a double-click (PR #2641 review, blocker 1: a
     *  double-click on a Maindeck tile removed two copies before the Inspect
     *  Overlay opened). Set, a pointer click waits out
     *  {@link DOUBLE_CLICK_WINDOW_MS} and a `dblclick` inside that window
     *  cancels it outright; unset, the click acts immediately, which is what
     *  the touch path wants — there a tap only opens the Peek Panel, nothing
     *  is lost by doing it twice, and a 300ms lag on the primary phone gesture
     *  would be felt on every single tap. */
    deferClick?: boolean;
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
    deferClick,
    stackIndex,
    isFeatured,
    isSelected,
    count,
}: DeckCardTileProps) {
    const { ref, isDragging } = useDraggable({ id: dragId, data: dragData });
    const stacked = stackIndex !== undefined;

    // The click/double-click arbitration (PR #2641 review, blocker 1). A
    // browser delivers a double-click as click(detail 1), click(detail 2),
    // dblclick — the PAIR arrives first, so a tile that acts on every click
    // has already fired its single-click action twice by the time the Inspect
    // Overlay opens. Two rules, in order:
    //
    //  1. `detail > 1` never acts. One gesture is one action, whatever the
    //     click count — this alone takes the double-click from two to one.
    //  2. when the action is destructive (`deferClick`) and there IS a
    //     double-click action, the first click waits out the double-click
    //     window instead of firing; the `dblclick` cancels it, so a
    //     double-click performs the read and nothing else.
    //
    // `detail === 0` skips the wait: a click with no click count is not part
    // of a pointer double-click sequence (keyboard activation of a control,
    // `element.click()`, a dispatched synthetic event), so nothing can follow
    // it and delaying it would only make the surface feel broken.
    const pendingClick = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelPendingClick = () => {
        if (pendingClick.current !== null) {
            clearTimeout(pendingClick.current);
            pendingClick.current = null;
        }
    };
    useEffect(() => cancelPendingClick, []);

    const handleClick = (event: React.MouseEvent) => {
        if (event.detail > 1) return;
        if (!deferClick || !onDoubleClick || event.detail === 0) {
            onClick();
            return;
        }
        cancelPendingClick();
        pendingClick.current = setTimeout(() => {
            pendingClick.current = null;
            onClick();
        }, DOUBLE_CLICK_WINDOW_MS);
    };

    const handleDoubleClick = onDoubleClick
        ? () => {
              cancelPendingClick();
              onDoubleClick();
          }
        : undefined;

    return (
        <div
            ref={ref}
            role="button"
            tabIndex={0}
            title={title}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
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
