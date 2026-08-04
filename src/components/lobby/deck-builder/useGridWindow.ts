import { useCallback, useEffect, useRef, useState } from "react";
import { computeGridWindow, type GridWindow } from "./gridWindow";

/** How many rows above and below the viewport stay mounted. Two rows on each
 *  side means a fast scroll shows real cards rather than gaps, while the
 *  mounted count stays bounded by the viewport. */
export const OVERSCAN_ROWS = 2;

/** How many entries to render before the first cell exists to measure. One
 *  screenful on any plausible layout; the real window replaces it on the very
 *  next frame. */
export const SEED_COUNT = 40;

/**
 * Nearest scrollable ancestor. The grid does not own its scroll container —
 * the deck builder does — and threading a ref down through the layout would
 * couple the two for nothing, so the grid finds its own.
 */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let node = el?.parentElement; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") return node;
    }
    return null;
}

const EMPTY: GridWindow = {
    start: 0,
    end: SEED_COUNT,
    offsetTop: 0,
    totalHeight: 0,
};

function same(a: GridWindow, b: GridWindow): boolean {
    return (
        a.start === b.start &&
        a.end === b.end &&
        a.offsetTop === b.offsetTop &&
        a.totalHeight === b.totalHeight
    );
}

/**
 * Windows a flex-wrap grid of uniform cells: returns the slice of `count`
 * entries near the viewport, plus the spacer geometry to render around it.
 *
 * Everything is MEASURED from the live layout rather than configured —
 * columns from the container and cell widths, row pitch from a cell's height
 * and the container's `row-gap`. The card size is a CSS custom property the
 * user can change with a zoom slider, so any hard-coded geometry here would go
 * stale the moment they drag it.
 *
 * @param count number of entries in the full match set
 * @param innerRef the flex-wrap container that holds the cells
 */
export function useGridWindow(
    count: number,
    /** The SPACER: a static, full-height box that the mounted rows are
     *  positioned inside. Every geometric input is read from this element and
     *  never from the moving row block — measuring the thing you reposition
     *  is a feedback loop (measure → move → measure again), and it froze the
     *  tab for tens of seconds before this was split in two. */
    outerRef: React.RefObject<HTMLDivElement | null>,
    /** The row block. Only its first CELL is read, for the cell size and the
     *  container's gaps. */
    innerRef: React.RefObject<HTMLDivElement | null>,
    /** Identity of the match set. A new filter pass produces a fresh array,
     *  which is the signal to jump back to the top — two different filters can
     *  match the same NUMBER of cards, so `count` cannot carry this. */
    resetKey: unknown
): GridWindow {
    const [win, setWin] = useState<GridWindow>(EMPTY);

    // A new match set is a new grid: drop back to the seed window rather than
    // keeping a slice that indexed into different results. Adjusting state
    // DURING RENDER (React's documented alternative to a set-state-in-effect,
    // which would render the stale window once and then cascade a second
    // render) — and `current` is used for this render too, so the old slice
    // never flashes.
    const [prevKey, setPrevKey] = useState(resetKey);
    let current = win;
    if (prevKey !== resetKey) {
        setPrevKey(resetKey);
        setWin(EMPTY);
        current = EMPTY;
    }

    // The last window `measure` produced. Kept in a ref, and written only from
    // inside `measure` and the reset effect, so `measure` can compare against
    // it without taking the window as a dependency — it is wired into a scroll
    // listener and a ResizeObserver, and re-subscribing those on every window
    // change would thrash.
    const lastRef = useRef<GridWindow>(EMPTY);

    const measure = useCallback(() => {
        const outer = outerRef.current;
        const inner = innerRef.current;
        const scroller = findScrollParent(outer);
        const cell = inner?.firstElementChild as HTMLElement | null;
        if (!outer || !inner || !scroller || !cell) return;

        const style = getComputedStyle(inner);
        const rowGap = Number.parseFloat(style.rowGap) || 0;
        const columnGap = Number.parseFloat(style.columnGap) || 0;

        const cellRect = cell.getBoundingClientRect();
        const cellWidth = cellRect.width;
        const cellHeight = cellRect.height;
        if (cellWidth <= 0 || cellHeight <= 0) return;

        // The spacer's top edge in the scroller's CONTENT coordinates — the
        // sticky results header and anything above it come first, so the grid
        // does not start at scrollTop 0. The spacer is in normal flow and the
        // row block is absolutely positioned inside it, so this value does not
        // move when the window slides.
        const gridTop =
            outer.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top +
            scroller.scrollTop;

        // The row block's WIDTH is safe to read even though its position is an
        // output: sliding the window changes `top`, never the width.
        const columns = Math.max(
            1,
            Math.floor(
                (inner.clientWidth + columnGap) / (cellWidth + columnGap)
            )
        );

        const next = computeGridWindow(
            {
                count,
                columns,
                rowHeight: cellHeight + rowGap,
                gridTop,
                scrollTop: scroller.scrollTop,
                viewportHeight: scroller.clientHeight,
                overscanRows: OVERSCAN_ROWS,
            },
            SEED_COUNT
        );

        // Guard the state write: measurement is driven by observers that fire
        // in response to rendering, so an unconditional `setWin` is an infinite
        // render loop.
        if (same(lastRef.current, next)) return;
        lastRef.current = next;
        setWin(next);
    }, [count, outerRef, innerRef]);

    // The scroll position is DOM, not state — resetting it belongs in an
    // effect, where it is a plain mutation with no re-render. The ref is
    // realigned with the window the render-time reset just installed.
    useEffect(() => {
        lastRef.current = EMPTY;
        const scroller = findScrollParent(outerRef.current);
        if (scroller) scroller.scrollTop = 0;
    }, [resetKey, outerRef]);

    useEffect(() => {
        const outer = outerRef.current;
        const scroller = findScrollParent(outer);
        if (!outer || !scroller) return;

        // Coalesce to one measurement per frame: a scroll event fires far more
        // often than the layout can change.
        //
        // The timer is not belt-and-braces. `requestAnimationFrame` does not
        // fire AT ALL in a backgrounded or occluded tab, so a grid first
        // rendered there would never measure itself and would stay stuck on
        // the seed slice — 40 cards and no scrollback — until something else
        // happened to re-render it. Whichever of the two fires first wins.
        let frame = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const run = () => {
            if (frame) cancelAnimationFrame(frame);
            if (timer) clearTimeout(timer);
            frame = 0;
            timer = undefined;
            measure();
        };
        const schedule = () => {
            if (frame || timer) return;
            frame = requestAnimationFrame(run);
            timer = setTimeout(run, 100);
        };

        scroller.addEventListener("scroll", schedule, { passive: true });
        // Observe only elements whose size is an INPUT to the measurement,
        // never one whose size the measurement changes: the spacer's height is
        // an output (`totalHeight`), so observing it would re-enter.
        const resize = new ResizeObserver(schedule);
        resize.observe(scroller);
        // The cell's own size changes with the zoom slider without either
        // container resizing.
        const cell = innerRef.current?.firstElementChild;
        if (cell) resize.observe(cell);

        // The FIRST measurement is synchronous: the seed slice is on screen
        // and every input it needs already exists.
        measure();
        return () => {
            if (frame) cancelAnimationFrame(frame);
            if (timer) clearTimeout(timer);
            scroller.removeEventListener("scroll", schedule);
            resize.disconnect();
        };
    }, [measure, outerRef, innerRef, current.start]);

    return current;
}
