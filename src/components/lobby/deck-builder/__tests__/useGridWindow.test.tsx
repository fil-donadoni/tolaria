import { useRef } from "react";
import { render, act, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { useGridWindow } from "../useGridWindow";

/**
 * The WIRING half of the windowed grid — the geometry itself is covered by
 * `gridWindow.test.ts`. What this pins down is that the hook re-measures when
 * the user scrolls, which is the difference between a working window and one
 * frozen on its first slice.
 *
 * jsdom performs no layout, so every rect is zero and nothing here would
 * measure on its own; the harness stubs the handful of values the hook reads.
 * That is the point — the test drives the REAL listener and the real
 * measurement, not a re-implementation of them.
 */

const CELL_W = 100;
const CELL_H = 140;
const GAP = 10;
const INNER_W = 550; // → 5 columns of (100 + 10)
const VIEWPORT_H = 300;

function stubRect(el: Element, top: number, width: number, height: number) {
    el.getBoundingClientRect = () =>
        ({
            top,
            left: 0,
            width,
            height,
            bottom: top + height,
            right: width,
        }) as DOMRect;
}

function Harness({ count }: { count: number }) {
    const outerRef = useRef<HTMLDivElement | null>(null);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const win = useGridWindow(count, outerRef, innerRef, count);
    return (
        <div data-testid="scroller" style={{ overflowY: "auto" }}>
            <div ref={outerRef} data-testid="outer">
                <div
                    ref={innerRef}
                    data-testid="inner"
                    style={{ rowGap: `${GAP}px`, columnGap: `${GAP}px` }}
                >
                    {Array.from({ length: win.end - win.start }, (_, i) => (
                        <div key={win.start + i} data-testid="cell" />
                    ))}
                </div>
                <output data-testid="state">
                    {`${win.start}:${win.end}:${win.offsetTop}:${win.totalHeight}`}
                </output>
            </div>
        </div>
    );
}

function readState(container: HTMLElement) {
    const [start, end, offsetTop, totalHeight] = container
        .querySelector('[data-testid="state"]')!
        .textContent!.split(":")
        .map(Number);
    return { start, end, offsetTop, totalHeight };
}

/** Applies the layout jsdom will not compute, then lets the hook re-measure. */
function layout(container: HTMLElement, scrollTop: number) {
    const scroller = container.querySelector(
        '[data-testid="scroller"]'
    ) as HTMLElement;
    const outer = container.querySelector('[data-testid="outer"]')!;
    const inner = container.querySelector(
        '[data-testid="inner"]'
    ) as HTMLElement;
    const cell = inner.firstElementChild;

    Object.defineProperty(scroller, "clientHeight", {
        value: VIEWPORT_H,
        configurable: true,
    });
    Object.defineProperty(scroller, "scrollHeight", {
        value: 100_000,
        configurable: true,
    });
    Object.defineProperty(inner, "clientWidth", {
        value: INNER_W,
        configurable: true,
    });
    stubRect(scroller, 0, INNER_W, VIEWPORT_H);
    // The grid starts flush with the scroll container in this harness.
    stubRect(outer, -scrollTop, INNER_W, 0);
    if (cell) stubRect(cell, 0, CELL_W, CELL_H);
    scroller.scrollTop = scrollTop;
    return scroller;
}

/** Stub the layout, then let the hook see it. The hook's first measurement
 *  runs before this test can install the stubs (effects fire at render), so a
 *  scroll event stands in for the ResizeObserver that re-measures in a real
 *  browser once layout settles. */
async function applyLayout(container: HTMLElement, scrollTop: number) {
    await act(async () => {
        layout(container, scrollTop).dispatchEvent(new Event("scroll"));
        // The hook coalesces the burst — wait past its fallback timer.
        await new Promise((r) => setTimeout(r, 200));
    });
}

describe("useGridWindow", () => {
    afterEach(cleanup);

    it("measures the grid and reserves the full height", async () => {
        const { container } = render(<Harness count={500} />);
        await applyLayout(container, 0);
        // 500 cards / 5 columns = 100 rows of (140 + 10).
        expect(readState(container).totalHeight).toBe(15_000);
    });

    it("mounts a bounded slice, not the whole match set", async () => {
        const { container } = render(<Harness count={500} />);
        await applyLayout(container, 0);
        const cells = container.querySelectorAll('[data-testid="cell"]').length;
        expect(cells).toBeGreaterThan(0);
        expect(cells).toBeLessThan(60);
    });

    it("slides the window when the scroll container scrolls", async () => {
        const { container } = render(<Harness count={500} />);
        await applyLayout(container, 0);
        const before = readState(container);

        await applyLayout(container, 4500); // 30 rows down

        const after = readState(container);
        expect(after.start).toBeGreaterThan(before.start);
        expect(after.offsetTop).toBeGreaterThan(0);
        // Still bounded — scrolling moves the window, it does not grow it.
        expect(after.end - after.start).toBeLessThan(60);
    });
});
