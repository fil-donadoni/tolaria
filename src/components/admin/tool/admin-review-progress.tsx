interface AdminReviewProgressProps {
    label: string;
    done: number;
    total: number;
    /** Shown instead of the count when `total` is 0. */
    emptyText: string;
}

/** A labelled `role="progressbar"` for a review pass over a scope (issue
 *  #3597): the one number that says whether the pass is worth continuing.
 *  Measured over the WHOLE scope by the caller, never a filtered view. */
export default function AdminReviewProgress({
    label,
    done,
    total,
    emptyText,
}: AdminReviewProgressProps) {
    const pct = total === 0 ? 0 : Math.round((done / total) * 100);
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-label">{label}</span>
                <span className="text-xs text-text-muted">
                    {total === 0 ? emptyText : `${done} of ${total} (${pct}%)`}
                </span>
            </div>
            <div
                className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
                aria-label={label}
            >
                <div
                    className="h-full bg-success transition-[width]"
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
}
