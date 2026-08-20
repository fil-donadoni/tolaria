import { useDraggable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileCardTop } from "~/lib/card-layout";
import {
    activateTileOnKey,
    CARD_TILE_ATTR,
    isTileNavKey,
    moveCardTileFocus,
} from "~/lib/card-tile-keyboard";
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
    stackIndex,
    isFeatured,
    isSelected,
    count,
}: DeckCardTileProps) {
    const { ref, isDragging } = useDraggable({ id: dragId, data: dragData });
    const stacked = stackIndex !== undefined;

    // THIS TILE BINDS ONE POINTER GESTURE, AND IT IS THE PRIMARY CLICK.
    //
    // Not a double-click, and not the secondary button either — both were
    // tried on this slice and both were wrong (PR #2641 review rounds 1-3):
    //
    //  - DOUBLE-CLICK shares its prefix with the click that MOVES the card. A
    //    browser delivers it as click(detail 1), click(detail 2), dblclick,
    //    so the pair of removals lands before `dblclick` does; arbitrating it
    //    with a deferred click cost a 300ms lag on the primary editing gesture
    //    and silently swallowed rapid cuts (a pending action owned by a
    //    component that unmounts as a consequence of the very action it was
    //    deferring — removing a card re-indexes its neighbours).
    //  - THE SECONDARY BUTTON IS ALREADY TAKEN, on this very element. The
    //    `CardImage` below mounts `CardPreview`, which binds native listeners
    //    on a DESCENDANT of this div: a button-2 `pointerdown` runs
    //    `useRightPressPreview`, whose quick-click PINS the anchored 330px
    //    preview, and `holdPreview={false}` deliberately does not disable it
    //    (`card-preview.tsx`: "Only the TOUCH gesture is suppressed"). Binding
    //    Inspect to `contextmenu` here opened BOTH card-reading surfaces at
    //    once — both body portals at `z-modal`, so which one paints on top is
    //    decided by document order, i.e. by the platform (Windows/Linux fire
    //    `contextmenu` on mouse-DOWN, before `pointerup`, inverting the macOS
    //    order). The repo already settles this the other way round:
    //    `ui/context-menu.tsx` and `activatable-ability-menu.tsx` move their
    //    menus to a SYNTHESIZED left click precisely because a genuine right
    //    click / long press is reserved for the preview.
    //
    // So there is no third pointer gesture to spend, and this slice does not
    // invent one. Card reading already has a path at every viewport: a mouse
    // gets `CardPreview`'s right-click pin (unchanged from `main`), a finger
    // gets tap -> Peek Panel -> `Inspect`. `★ Featured`, whose per-card
    // overlay button this issue removed, is DECK-level metadata and moves to
    // the deck-detail row (`deck-featured-select.tsx`) — the home issue #2584
    // names ("Featured moves to the Inspect Overlay / deck detail").

    // KEYBOARD OPERATION IS PART OF THE ROLE, NOT AN EXTRA (issue #2593).
    //
    // This element has carried `role="button" tabIndex={0}` since #1581 with no
    // `onKeyDown` at all: an ARIA role that PROMISES an activation a keyboard
    // could never fire (WCAG 2.1.1). Enter and Space are what a native
    // `<button>` would have done for free; the arrows are the grid navigation
    // (`lib/card-tile-keyboard.ts`), which is the only way to reach the tile
    // AFTER this one without tabbing through every card in the deck.
    //
    // `e.target !== e.currentTarget` bails on a key pressed inside a
    // descendant, matching `deck-list-item.tsx` — nothing focusable renders in
    // here today, and the guard is what keeps that true if something does.
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (activateTileOnKey(e, onClick)) return;
        if (e.target !== e.currentTarget) return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (!isTileNavKey(e.key)) return;
        // Only swallow the key when focus actually moved: at the edge of the
        // grid the arrow must fall through and scroll the pane as usual.
        if (moveCardTileFocus(e.currentTarget, e.key)) e.preventDefault();
    };

    return (
        <div
            ref={ref}
            role="button"
            tabIndex={0}
            {...{ [CARD_TILE_ATTR]: "" }}
            title={title}
            onClick={onClick}
            onKeyDown={handleKeyDown}
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
                // No `outline-none` (issue #2593): this tile is a tab stop, so
                // killing the ring left a keyboard user with no cursor at all.
                // `focus-visible:z-20` lifts the focused tile clear of the
                // pile-mates overlapping it — a buried tile shows a ~20px
                // sliver, and a ring on a sliver is not a visible focus
                // indicator (WCAG 2.4.11).
                "group aspect-5/7 w-(--card-w) shrink-0 cursor-grab touch-pan-x select-none transition hover:-translate-y-0.5 hover:z-10",
                "focus-visible:z-20 focus-visible:-translate-y-0.5",
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
