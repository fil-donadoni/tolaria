import CardImage from "~/components/cards/card-image";
import CardPreview from "~/components/cards/card-preview";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { cn } from "~/lib/utils";
import { effectiveRating } from "./pick-ratings-model";

interface PickRatingsPackCardProps {
    card: ScopeCardRating;
    /** The card under review. */
    openName: string;
    position: number;
    self: boolean;
    /** Bright = the pick's context can flip it against the open card. */
    flippable: boolean;
    disabled: boolean;
    onRateAbove: () => void;
}

/** One card of the pack test: clicking it rates the open card half a point
 *  above it; right click previews it. */
export default function PickRatingsPackCard({
    card,
    openName,
    position,
    self,
    flippable,
    disabled,
    onRateAbove,
}: PickRatingsPackCardProps) {
    return (
        <CardPreview
            cardId={card.cardId}
            cardName={card.name}
            holdPreview={false}
        >
            <button
                type="button"
                disabled={self || disabled}
                data-pick-rating-pack-card={card.cardId}
                data-flippable={flippable || self}
                onClick={onRateAbove}
                title={
                    self
                        ? card.name
                        : `${card.name} · click to rate ${openName} above it`
                }
                className={cn(
                    "relative block aspect-5/7 w-full overflow-hidden rounded-md transition",
                    self
                        ? "ring-2 ring-accent-strong"
                        : "hover:ring-1 hover:ring-border-subtle",
                    !flippable && !self && "opacity-35 hover:opacity-100"
                )}
            >
                <CardImage card={{ id: card.cardId }} lazy sizes="132px" />
                <span className="absolute top-1 left-1 rounded-xs bg-surface-base/80 px-1 font-mono text-xs text-text">
                    #{position}
                </span>
                <span className="absolute top-1 right-1 rounded-xs bg-surface-base/80 px-1 font-mono text-xs text-text">
                    {effectiveRating(card).toFixed(1)}
                </span>
            </button>
        </CardPreview>
    );
}
