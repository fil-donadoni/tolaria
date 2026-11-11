import { cn } from "~/lib/utils";
import {
    ratingSource,
    SOURCE_LABEL,
    type RatingSource,
} from "./pick-ratings-model";
import type { ScopeCardRating } from "~/hooks/useCardRatings";

const LAYERS: readonly {
    source: RatingSource;
    value: (card: ScopeCardRating) => number | null;
}[] = [
    { source: "override", value: (card) => card.dbRating },
    { source: "seed", value: (card) => card.seedRating },
    { source: "median", value: (card) => card.fallbackRating },
];

/** The three layers under the art: the active one — the layer the effective
 *  rating comes from — reads in full ink. */
export default function PickRatingsDialogLayers({
    card,
}: {
    card: ScopeCardRating;
}) {
    const active = ratingSource(card);
    return (
        <div className="flex flex-col gap-0.5 border-t border-border-subtle/30 pt-2">
            {LAYERS.map(({ source, value }) => {
                const rating = value(card);
                return (
                    <div
                        key={source}
                        data-pick-rating-layer={source}
                        data-active={source === active}
                        className={cn(
                            "flex items-baseline justify-between text-xs",
                            source === active ? "text-text" : "text-text-muted"
                        )}
                    >
                        <span>{SOURCE_LABEL[source]}</span>
                        <span className="font-mono">
                            {rating === null ? "—" : rating.toFixed(1)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}
