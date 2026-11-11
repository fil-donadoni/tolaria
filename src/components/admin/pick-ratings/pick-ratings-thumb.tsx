import CardImage from "~/components/cards/card-image";
import CardPreview from "~/components/cards/card-preview";

interface PickRatingsThumbProps {
    cardId: string;
    name: string;
    /** Tailwind width class of the thumbnail. */
    width: string;
    sizes: string;
    title?: string;
    /** Left click. Absent = the thumbnail is not a button of its own. */
    onSelect?: () => void;
}

/** A small card of the rating dialog: right click pins the app's
 *  `CardPreview`, left click hands the card to `onSelect`. The click stops
 *  here, or the rung underneath would rate the open card. */
export default function PickRatingsThumb({
    cardId,
    name,
    width,
    sizes,
    title,
    onSelect,
}: PickRatingsThumbProps) {
    return (
        <span className={`block ${width} shrink-0`}>
            <CardPreview cardId={cardId} cardName={name} holdPreview={false}>
                <button
                    type="button"
                    data-pick-rating-thumb={cardId}
                    aria-label={name}
                    title={title ?? name}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSelect?.();
                    }}
                    className="relative block aspect-5/7 w-full overflow-hidden rounded-xs ring-border-subtle hover:ring-1"
                >
                    <CardImage card={{ id: cardId }} lazy sizes={sizes} />
                </button>
            </CardPreview>
        </span>
    );
}
