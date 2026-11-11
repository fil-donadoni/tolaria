import { useMemo, useState } from "react";
import SegmentedControl from "~/components/ui/segmented-control";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import PickRatingsLadderRung from "./pick-ratings-ladder-rung";
import {
    COMPARE_OPTIONS,
    RATING_STEPS,
    rungCards,
    toStep,
    type CompareBy,
} from "./pick-ratings-ladder-model";
import { effectiveRating } from "./pick-ratings-model";

interface PickRatingsLadderProps {
    card: ScopeCardRating;
    all: readonly ScopeCardRating[];
    disabled: boolean;
    onRate: (step: number) => void;
    onOpenNeighbour: (cardId: string) => void;
}

/** The ladder: eleven rungs 5.0 → 0.0, each carrying the comparable cards
 *  already on it. The rating IS a position on the scale, so "is this a 3.5
 *  next to those 3.5s?" is answered by eye. */
export default function PickRatingsLadder({
    card,
    all,
    disabled,
    onRate,
    onOpenNeighbour,
}: PickRatingsLadderProps) {
    const [compare, setCompare] = useState<CompareBy>("colour");
    const rungs = useMemo(
        () => rungCards(card, all, compare),
        [card, all, compare]
    );
    const here = toStep(effectiveRating(card));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="text-label text-text-muted">Compare with</span>
                <SegmentedControl
                    ariaLabel="Compare with"
                    options={COMPARE_OPTIONS}
                    value={compare}
                    onChange={setCompare}
                />
            </div>
            <div className="flex flex-col">
                {[...RATING_STEPS].reverse().map((step) => (
                    <PickRatingsLadderRung
                        key={step}
                        step={step}
                        card={card}
                        neighbours={rungs.get(step) ?? []}
                        disabled={disabled}
                        here={step === here}
                        onRate={onRate}
                        onOpenNeighbour={onOpenNeighbour}
                    />
                ))}
            </div>
            <p className="text-xs text-text-muted">
                Click a rung to rate. Cards closest in cost come first. On a
                card: right-click for the preview, click to open it here and
                reposition it, then come back.
            </p>
        </div>
    );
}
