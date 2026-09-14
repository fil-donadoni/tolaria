interface CardProfileReviewProgressProps {
    /** Profiled cards in the chosen scope whose effective profile is already
     *  flagged `reviewed`. */
    reviewed: number;
    /** Profiled cards in the chosen scope — the denominator of the pass, NOT
     *  the scope's total card count: a card with no profile at either layer
     *  is nothing to review. */
    total: number;
}

/** The review pass's progress against its own scope (issue #3597).
 *
 *  The census lands EVERY row `reviewed: false` and each one contributes at
 *  half the contextual cap until a human confirms it (ADR 0072), so "how much
 *  of this scope is still LLM-weight" is the one number that says whether the
 *  pass is worth continuing today — and a search box over a list of several
 *  hundred rows could not answer it at all. Mirrors the Limited table panel's
 *  labelled `role="progressbar"` bar, the app's existing recipe for exactly
 *  this shape of fact. */
export default function CardProfileReviewProgress({
    reviewed,
    total,
}: CardProfileReviewProgressProps) {
    const pct = total === 0 ? 0 : Math.round((reviewed / total) * 100);
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-medium text-text-muted">
                    Human review pass
                </span>
                <span className="text-[11px] text-text-muted">
                    {total === 0
                        ? "No profiled cards in this scope"
                        : `${reviewed} of ${total} reviewed (${pct}%)`}
                </span>
            </div>
            <div
                className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={reviewed}
                aria-label="Card Profiles reviewed"
            >
                <div
                    className="h-full bg-success transition-[width]"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}
