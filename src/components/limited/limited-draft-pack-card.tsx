import { useDraggable } from "@dnd-kit/react";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import { cn } from "~/lib/utils";
import CardImage from "~/components/cards/card-image";
import type { BoosterDragData } from "./limitedDraftDrag";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

/** One pickable card in the pack in front of the viewer (PRD #1107, issue
 *  #1112; gestures per ADR 0060, issue #1248):
 *
 *  - single click → SELECTS only (`onSelect`) — never commits a Pick. The
 *    Selected Card is what a timer expiry Auto-Picks (issue #1249).
 *  - double click → commits the Pick (`onPick`) into the card's Mana-Value
 *    column by default.
 *  - right click → opens the "Pick" / "Pick to sideboard" context menu
 *    (`onOpenMenu`).
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
    pending,
}: {
    card: DraftPackCard;
    /** True when this card is the seat's current Selected Card
     *  (`seat.selectedPickId`). */
    selected: boolean;
    onSelect: (pickId: string) => void;
    onPick: (pickId: string) => void;
    onOpenMenu: (pickId: string, x: number, y: number) => void;
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
            onClick={() => {
                if (pending) return;
                onSelect(card.pickId);
            }}
            onDoubleClick={() => {
                if (pending) return;
                onPick(card.pickId);
            }}
            onContextMenu={(e) => {
                e.preventDefault();
                if (pending) return;
                onOpenMenu(card.pickId, e.clientX, e.clientY);
            }}
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
                "group relative block aspect-5/7 w-full cursor-grab touch-none rounded-[7%] ring-accent transition select-none",
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
                it unclippable by the scroller with no tile-width cost. */}
            {selected && (
                <div
                    data-testid="selection-ring"
                    className="pointer-events-none absolute inset-0 rounded-[7%] ring-4 ring-inset ring-accent"
                />
            )}
        </div>
    );
}
