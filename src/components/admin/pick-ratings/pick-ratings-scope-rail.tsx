import type { DraftableSetInfo } from "~/hooks/useLimitedEvent";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import LimitedScopePicker from "~/components/lobby/limited-scope-picker";
import AdminReviewProgress from "../tool/admin-review-progress";
import {
    COLOUR_LABEL,
    colourAverages,
    overrideCount,
    ratingDistribution,
    ratingProgress,
} from "./pick-ratings-model";

interface PickRatingsScopeRailProps {
    scopes: DraftableSetInfo[];
    scope: string | undefined;
    onScopeChange: (scope: string) => void;
    cards: ScopeCardRating[] | undefined;
}

/** The rail body: the scope, the Hand-rated progress, the Overrides count,
 *  the rating distribution and the per-colour averages (prototype verdict,
 *  PRD #8772). All measured over the WHOLE scope, never the filtered view. */
export default function PickRatingsScopeRail({
    scopes,
    scope,
    onScopeChange,
    cards,
}: PickRatingsScopeRailProps) {
    const progress = ratingProgress(cards);
    const distribution = ratingDistribution(cards);
    const peak = Math.max(1, ...distribution.map((bucket) => bucket.count));
    return (
        <div className="flex flex-col gap-4">
            <LimitedScopePicker
                scopes={scopes}
                value={scope}
                onChange={onScopeChange}
                ariaLabel="Rating Scope"
            />
            <AdminReviewProgress
                label="Hand-rated"
                done={progress.rated}
                total={progress.total}
                emptyText="No cards in this scope"
            />
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-label">Overrides</span>
                <span className="text-xs text-text-muted">
                    {overrideCount(cards)}
                </span>
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-label">Rating distribution</span>
                {distribution.map(({ rating, count }) => (
                    <div
                        key={rating}
                        className="flex items-center gap-2 text-xs"
                    >
                        <span className="w-4 tabular-nums text-text-muted">
                            {rating}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                            <div
                                className="h-full bg-accent"
                                style={{ width: `${(count / peak) * 100}%` }}
                            />
                        </div>
                        <span className="w-8 text-right tabular-nums text-text-muted">
                            {count}
                        </span>
                    </div>
                ))}
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-label">Average by colour</span>
                {colourAverages(cards).map(({ colour, count, average }) => (
                    <div
                        key={colour}
                        className="flex items-baseline justify-between gap-2 text-xs"
                    >
                        <span className="text-text">
                            {COLOUR_LABEL[colour]}
                        </span>
                        <span className="text-text-muted">
                            {average === null
                                ? "—"
                                : `${average.toFixed(2)} · ${count} cards`}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
