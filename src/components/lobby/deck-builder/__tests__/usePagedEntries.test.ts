// Issue #505 / PRD #501: the results grid must render a bounded batch and grow
// it on scroll, rather than rendering every match on every keystroke. The
// `usePagedEntries` hook owns that visible-slice state; these tests pin its
// three contractual behaviors — initial slice size, `loadMore()` growth, and
// reset on a new filtered set — independently of the IntersectionObserver glue.
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { RESULTS_BATCH_SIZE, usePagedEntries } from "../usePagedEntries";

function makeEntries(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i);
}

describe("usePagedEntries", () => {
    it("renders at most the batch size initially, regardless of total", () => {
        const entries = makeEntries(RESULTS_BATCH_SIZE * 5);
        const { result } = renderHook(() => usePagedEntries(entries));
        expect(result.current.visible).toHaveLength(RESULTS_BATCH_SIZE);
        expect(result.current.hasMore).toBe(true);
    });

    it("loadMore() grows the visible slice by exactly one batch", () => {
        const entries = makeEntries(RESULTS_BATCH_SIZE * 3);
        const { result } = renderHook(() => usePagedEntries(entries));

        act(() => result.current.loadMore());
        expect(result.current.visible).toHaveLength(RESULTS_BATCH_SIZE * 2);

        act(() => result.current.loadMore());
        expect(result.current.visible).toHaveLength(RESULTS_BATCH_SIZE * 3);
    });

    it("never overshoots the total and clears hasMore when fully shown", () => {
        const entries = makeEntries(RESULTS_BATCH_SIZE + 10);
        const { result } = renderHook(() => usePagedEntries(entries));
        expect(result.current.hasMore).toBe(true);

        act(() => result.current.loadMore());
        expect(result.current.visible).toHaveLength(RESULTS_BATCH_SIZE + 10);
        expect(result.current.hasMore).toBe(false);
    });

    it("resets to the first batch when the input entry set changes identity", () => {
        const first = makeEntries(RESULTS_BATCH_SIZE * 3);
        const { result, rerender } = renderHook(
            ({ entries }) => usePagedEntries(entries),
            { initialProps: { entries: first } }
        );

        // Scroll forward two batches.
        act(() => result.current.loadMore());
        act(() => result.current.loadMore());
        expect(result.current.visible).toHaveLength(RESULTS_BATCH_SIZE * 3);

        // A new filter pass yields a fresh array — paging resets to batch one.
        const second = makeEntries(RESULTS_BATCH_SIZE * 4);
        rerender({ entries: second });
        expect(result.current.visible).toHaveLength(RESULTS_BATCH_SIZE);
        expect(result.current.visible[0]).toBe(0);
    });

    it("treats an undefined (loading) entry set as empty with no more", () => {
        const { result } = renderHook(() => usePagedEntries(undefined));
        expect(result.current.visible).toEqual([]);
        expect(result.current.hasMore).toBe(false);
    });

    it("honors a custom batch size", () => {
        const entries = makeEntries(25);
        const { result } = renderHook(() => usePagedEntries(entries, 10));
        expect(result.current.visible).toHaveLength(10);
        act(() => result.current.loadMore());
        expect(result.current.visible).toHaveLength(20);
        act(() => result.current.loadMore());
        expect(result.current.visible).toHaveLength(25);
        expect(result.current.hasMore).toBe(false);
    });
});
