import { useMemo, useState } from "react";

/** Issue #505 / PRD #501: how many result cards the grid renders per batch.
 *  Single tuning constant — the grid shows this many initially and grows by
 *  this many each time the infinite-scroll sentinel comes into view. Chosen for
 *  feel; can be adjusted without changing the paging architecture. */
export const RESULTS_BATCH_SIZE = 60;

export interface PagedEntries<T> {
    /** The currently-visible prefix of `entries` (at most `count`). */
    visible: T[];
    /** True while more entries remain beyond the visible slice. */
    hasMore: boolean;
    /** Append the next batch. No-op once everything is visible. */
    loadMore: () => void;
}

/** Bounds rendering of a large match set: exposes a visible prefix that starts
 *  at one batch and grows by `batchSize` per `loadMore()`. The slice resets to
 *  the first batch whenever the input `entries` identity changes (i.e. a new
 *  filter pass produced a fresh array), so a new query always shows its top
 *  results first.
 *
 *  `entries` may be `undefined` while the card index is still loading — the hook
 *  treats that as an empty, no-more set. */
export function usePagedEntries<T>(
    entries: T[] | undefined,
    batchSize = RESULTS_BATCH_SIZE
): PagedEntries<T> {
    // State holds both the visible count and the entry array it is anchored to.
    // Resetting on a new filtered set is then pure "adjust state while
    // rendering" (React's preferred alternative to a setState-in-effect, which
    // triggers a cascading render) with no ref mutation:
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const [paging, setPaging] = useState<{
        count: number;
        anchor: T[] | undefined;
    }>({ count: batchSize, anchor: entries });

    // `useCardSearch` returns a fresh array on every filter change, so an
    // identity change is a reliable signal that the user narrowed/widened the
    // query — reset to the first batch (and use it in *this* render too, so a
    // new set never flashes the previous, larger slice for one frame).
    let count = paging.count;
    if (paging.anchor !== entries) {
        count = batchSize;
        setPaging({ count: batchSize, anchor: entries });
    }

    const total = entries?.length ?? 0;
    const visible = useMemo(
        () => (entries ? entries.slice(0, count) : []),
        [entries, count]
    );

    return {
        visible,
        hasMore: count < total,
        loadMore: () =>
            setPaging((p) => ({
                count: p.count + batchSize,
                anchor: p.anchor,
            })),
    };
}
