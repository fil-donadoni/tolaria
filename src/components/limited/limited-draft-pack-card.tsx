import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import CardImage from "~/components/cards/card-image";

type DraftPackCard = NonNullable<LimitedEventSeatView["currentPack"]>[number];

/** One pickable card in the pack in front of the viewer (PRD #1107, issue
 *  #1112). Renders the card's face (Draftmancer-style) rather than its name:
 *  the whole tile is the Pick button, `onPick(pickId)` fires on click, and the
 *  card's own `CardPreview` hover/zoom rides along via `CardImage`. `pickId`
 *  (not array position) identifies the physical card, so display sorting never
 *  changes which card gets picked. */
export default function LimitedDraftPackCard({
    card,
    onPick,
    pending,
}: {
    card: DraftPackCard;
    onPick: (pickId: string) => void;
    pending: boolean;
}) {
    return (
        <button
            type="button"
            onClick={() => onPick(card.pickId)}
            disabled={pending}
            title={card.cardName}
            aria-label={`Pick ${card.cardName}`}
            className="group relative block aspect-5/7 w-full rounded-[7%] outline-none ring-accent transition focus-visible:ring-2 enabled:hover:-translate-y-0.5 enabled:hover:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
            <CardImage card={{ id: card.cardId }} lazy sizes="180px" />
        </button>
    );
}
