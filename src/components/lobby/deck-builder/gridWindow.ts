/**
 * Geometry for the windowed (virtualised) result grid.
 *
 * The deck-builder grid used to render an ever-growing prefix of the match set
 * — one batch, then two, then N as the user scrolled — so a 540-card cube
 * ended with 540 mounted cards, 540 `<CardImage>` subtrees and 540 decoded
 * bitmaps. Past a few hundred, Chrome stops painting whole regions of the
 * page: cards flicker in and out, and the header and filters disappear even
 * though the DOM, geometry and image loads are all correct.
 *
 * Windowing removes the cause instead of raising the ceiling: only the rows
 * near the viewport are in the DOM at all, so the mounted count is bounded by
 * the viewport (a couple of dozen) no matter how large the match set is.
 *
 * This module is the PURE half — index arithmetic with no DOM access — so the
 * part that is easy to get subtly wrong (off-by-one at the boundaries, the
 * empty set, a partial last row) is unit-testable. `useGridWindow` owns the
 * measurement and the listeners.
 */

export interface GridMetrics {
    /** Total number of entries in the match set. */
    count: number;
    /** Cards per row, as laid out by the flex-wrap container. */
    columns: number;
    /** Row pitch in px: one cell's height plus the row gap. */
    rowHeight: number;
    /** The grid's top edge, in the scroll container's content coordinates. */
    gridTop: number;
    /** The scroll container's current `scrollTop`. */
    scrollTop: number;
    /** The scroll container's visible height. */
    viewportHeight: number;
    /** Extra rows to keep mounted above and below the viewport. */
    overscanRows: number;
}

export interface GridWindow {
    /** First entry index to render (inclusive). */
    start: number;
    /** Last entry index to render (exclusive). */
    end: number;
    /** px offset of the first rendered row from the grid's top edge. */
    offsetTop: number;
    /** px height of the full grid, rendered as a spacer so the scrollbar
     *  reflects the whole match set and not just the mounted rows. */
    totalHeight: number;
}

/**
 * The visible index range, given where the grid sits and where the user has
 * scrolled to.
 *
 * `columns` or `rowHeight` of 0 means "not measured yet" — before the first
 * cell exists there is nothing to measure, so the caller renders a fixed seed
 * slice and this returns it unchanged rather than guessing a geometry.
 */
export function computeGridWindow(
    metrics: GridMetrics,
    fallbackCount: number
): GridWindow {
    const { count, columns, rowHeight } = metrics;

    if (count === 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };

    if (columns <= 0 || rowHeight <= 0) {
        return {
            start: 0,
            end: Math.min(count, fallbackCount),
            offsetTop: 0,
            totalHeight: 0,
        };
    }

    const totalRows = Math.ceil(count / columns);
    const totalHeight = totalRows * rowHeight;

    // Where the viewport sits relative to the grid's own top edge. Negative
    // while the grid is still below the fold (the sticky results header and
    // anything above it occupy the scroller first).
    const relativeTop = metrics.scrollTop - metrics.gridTop;

    const firstVisibleRow = Math.floor(relativeTop / rowHeight);
    const lastVisibleRow = Math.floor(
        (relativeTop + metrics.viewportHeight) / rowHeight
    );

    // `startRow` is clamped at BOTH ends. Past the last row it would produce
    // `start > end`, so the slice comes back empty and the grid renders
    // nothing — which happens for real whenever the match set shrinks (a
    // narrower filter) while the scroll position still points into the old,
    // longer one.
    const startRow = Math.min(
        Math.max(0, firstVisibleRow - metrics.overscanRows),
        totalRows - 1
    );
    const endRow = Math.min(
        totalRows,
        lastVisibleRow + 1 + metrics.overscanRows
    );

    return {
        start: startRow * columns,
        // The last row is usually partial — clamp so the slice never runs past
        // the match set.
        end: Math.min(count, endRow * columns),
        offsetTop: startRow * rowHeight,
        totalHeight,
    };
}
