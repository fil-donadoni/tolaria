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
                "group relative block aspect-5/7 w-full cursor-grab touch-none rounded-[7%] outline-none ring-accent transition select-none",
                pending
                    ? "cursor-not-allowed opacity-60"
                    : "hover:-translate-y-0.5",
                selected ? "ring-4 ring-accent" : "",
                isDragging ? "opacity-30" : ""
            )}
        >
            <CardImage card={{ id: card.cardId }} lazy sizes="180px" />
        </div>
    );
}
