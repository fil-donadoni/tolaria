import { useDraggable } from "@dnd-kit/react";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { cn } from "~/lib/utils";
import CardImage from "~/components/cards/card-image";
import type { BoosterDragData } from "./limitedDraftDrag";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

/** One pickable card in the pack in front of the viewer (PRD #1107, issue
 *  #1112; gestures per ADR 0060, issue #1248 — re-worked by issue #2861 for
 *  desktop's card-context-menu regime, double-click restored on desktop by
 *  issue #2894 after #2861 retired it):
 *
 *  - single click → always SELECTS (`onSelect`) — never commits a Pick by
 *    itself. The Selected Card is what a timer expiry Auto-Picks (issue
 *    #1249). Desktop additionally opens the pack menu right there
 *    (`onOpenMenu`, no delay — it runs alongside double-click rather than
 *    arbitrating against it, see below).
 *  - double click → commits the Pick (`onPick`) into the card's Mana-Value
 *    column by default, on BOTH phone and desktop (issue #2894) — desktop's
 *    menu ("Pick"/"→ Side"/"Inspect") and drag-and-drop stay available too,
 *    it is just one more way to reach the same `handlePick`.
 *  - right click → phone opens the "Pick" / "Pick to sideboard" context menu
 *    (`onOpenContextMenu`). Desktop has NO handler at all (issue #2889,
 *    reverting part of #2861): a real right-click means the app's ordinary
 *    anchored card preview everywhere else, and the Draft Room does not get
 *    to be a special case — this component neither intercepts the event nor
 *    calls `preventDefault`, so `CardImage`'s own `CardPreview` (its
 *    pointerdown-driven pin, unmodified here) is what the player sees. The
 *    Inspect Overlay stays reachable only through the desktop menu's own
 *    "Inspect" item — an explicit choice, never a right-click surprise.
 *  - drag → also commits the Pick, to whichever Pool column or the
 *    Sideboard it's dropped on (handled by the shared `DragDropProvider` in
 *    `limited-draft-table.tsx`; this component only registers the
 *    draggable).
 *
 *  Renders the card's face (Draftmancer-style) rather than its name — the
 *  whole tile is the interaction surface, and the card's own `CardPreview`
 *  hover/zoom rides along via `CardImage`. `pickId` (not array position)
 *  identifies the physical card, so display sorting never changes which
 *  card gets picked/selected. */
export default function LimitedDraftPackCard({
    card,
    selected,
    onSelect,
    onPick,
    onOpenMenu,
    onOpenContextMenu,
    pending,
}: {
    card: DraftPackCard;
    /** True when this card is the seat's current Selected Card
     *  (`seat.selectedPickId`). */
    selected: boolean;
    onSelect: (pickId: string) => void;
    /** Double-click commits the Pick, on both phone and desktop (issue
     *  #2894, reverting the desktop part of #2861). */
    onPick?: (pickId: string) => void;
    /** Left click ALSO opens the pack menu, right there, no delay (desktop,
     *  issue #2861). Absent ⇒ a click only selects (phone, unchanged). */
    onOpenMenu?: (pickId: string, x: number, y: number) => void;
    /** Real right-click opens the phone's "Pick" / "Pick to sideboard" menu.
     *  Absent on desktop (issue #2889) — there, a right-click falls through
     *  to the ordinary `CardPreview` pin, same as everywhere else. */
    onOpenContextMenu?: (pickId: string, x: number, y: number) => void;
    pending: boolean;
}) {
    const data: BoosterDragData = {
        kind: "booster",
        pickId: card.pickId,
        cardId: card.cardId,
        cardName: card.cardName,
    };
    const { ref, isDragging } = useDraggable({
        id: `booster-${card.pickId}`,
        data,
        disabled: pending,
    });

    return (
        <div
            ref={ref}
            role="button"
            tabIndex={pending ? -1 : 0}
            aria-disabled={pending}
            aria-pressed={selected}
            title={card.cardName}
            aria-label={`Draft pick: ${card.cardName}${selected ? " (selected)" : ""}`}
            onClick={(e) => {
                if (pending) return;
                onSelect(card.pickId);
                onOpenMenu?.(card.pickId, e.clientX, e.clientY);
            }}
            onDoubleClick={
                onPick
                    ? () => {
                          if (pending) return;
                          onPick(card.pickId);
                      }
                    : undefined
            }
            onContextMenu={
                onOpenContextMenu
                    ? (e) => {
                          e.preventDefault();
                          if (pending) return;
                          onOpenContextMenu(card.pickId, e.clientX, e.clientY);
                      }
                    : undefined
            }
            className={cn(
                // No `outline-none` (issue #2593). This tile is the Draft
                // Room's tab stop — `useDraftKeyboardPicks` (#2587) steps the
                // selection through it with the arrows — and killing the
                // outline left the keyboard user with no cursor at all on the
                // one surface that has a keyboard model. The global
                // `:focus-visible` rule (src/index.css, unlayered) paints it.
                // `ring-accent` here is INERT: Tailwind's ring utilities only
                // paint when a ring-WIDTH class (`ring-2`, `ring-4`, …) sets
                // `--tw-ring-shadow`, and this tile no longer carries one —
                // the color variable has nothing to paint with. It is kept
                // only so a future `ring-*` width utility added to this
                // className composes against the right color token.
                //
                // `touch-pan-y`, not `touch-none` (issue #2664). The phone
                // pack grid (`limited-draft-pack.tsx`) IS the vertical
                // scroller — a fixed-column grid with no wrapper, `overflow-y:
                // auto` — and a drag on this tile is what selects/picks it
                // (`useDraggable` above, driven by the SAME
                // `useDeckDragSensors` config the deckbuilder pool uses:
                // `limited-draft-table.tsx` passes it into the shared
                // `DragDropProvider`). `touch-none` blocked ALL native
                // panning at `touchstart`, before dnd-kit's touch `Delay`
                // constraint (250ms) ever got a chance to run — so a drag
                // starting ON a tile (the only place a card can be grabbed)
                // could never scroll the grid, and cards past the fold were
                // unreachable at the `dense` rung. dnd-kit's `PointerSensor`
                // never calls `preventDefault` while waiting on the Delay
                // timer, and only registers its own `touchmove`
                // `preventDefault` once the delay elapses WITHOUT the finger
                // moving past its tolerance (`node_modules/@dnd-kit/dom`'s
                // `DelayConstraint`/`_PointerSensor.handleStart`) — so CSS is
                // what decides whether a quick vertical swipe is EVER seen as
                // a scroll. `pan-y` lets the browser own that swipe (a hold
                // with no movement still reaches the JS timer and starts the
                // drag); it still blocks native horizontal panning and pinch
                // zoom, neither of which this tile uses. Same fix shape as
                // `deck-card-tile.tsx` (`touch-pan-x`, issue #1633) and
                // `board-hand-card.tsx`'s `allowHorizontalPan` (#1994),
                // mirrored onto the vertical axis this grid actually scrolls.
                // Scroll chaining into the two-stop snap scroller above the
                // grid is already contained (`overscroll-contain` on both the
                // grid and `draft-portrait-panes.tsx` /
                // `draft-landscape-panes.tsx`'s outer scroller) — this class
                // only decides whether the INNERMOST scroll can start.
                "group relative block aspect-5/7 w-full cursor-grab touch-pan-y card-corner transition select-none",
                pending
                    ? "cursor-not-allowed opacity-60"
                    : "hover:-translate-y-0.5",
                isDragging ? "opacity-30" : ""
            )}
        >
            {/* PRD #2405 / issue #2583: on an editing surface a 250ms touch hold is
                the DRAG (gesture model A), so the hold-preview is off — the
                card is read through the Peek Panel's Inspect CTA instead. */}
            <CardImage
                card={{ id: card.cardId }}
                lazy
                sizes="180px"
                holdPreview={false}
            />
            {/* Issue #2663: the phone pack grid (`limited-draft-pack.tsx`) is
                itself the clipping scroller — its tracks sit flush against
                its own edges with zero inline/block padding, so a ring drawn
                OUTSIDE the border box (Tailwind's default) gets cut off on
                every edge column/row. `ring-inset` alone does not fix this:
                an inset box-shadow paints in the element's OWN box-decoration
                layer, below every descendant — and `<CardImage>`'s `img` ==
                this tile's box exactly, so an inset ring on the tile itself
                is painted entirely UNDER the card art and is invisible
                (caught in review). The fix is a separate overlay element,
                rendered AFTER `<CardImage>` so it paints on top, carrying the
                inset ring — same shape `deck-card-tile.tsx` already uses for
                its own selected/featured overlays. Inset + its own box keeps
                it unclippable by the scroller with no tile-width cost.

                Issue #2724 generalised exactly this shape into the shared
                `.card-ring` recipe (a `::after` pseudo-element, so it needs no
                overlay of its own) — but this tile keeps ITS overlay, because
                the reason for it here is the DOM order the test above pins,
                not the paint order. `[--card-ring-w:4px]` preserves the pack
                card's heavier ring; every other card surface takes the 2px
                default. */}
            {selected && (
                <div
                    data-testid="selection-ring"
                    className="pointer-events-none absolute inset-0 card-ring card-ring-selected [--card-ring-w:4px]"
                />
            )}
        </div>
    );
}
