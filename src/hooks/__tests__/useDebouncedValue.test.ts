// Issue #503 / PRD #501: the deck-builder search box must stay responsive while
// typing — only its *settled* value (after ~180ms) may reach the filter pass and
// the URL. `useDebouncedValue` is the seam that enforces that: a burst of
// keystrokes collapses to a single trailing emission, and clearing the box
// emits promptly so the idle prompt returns without lag.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDebouncedValue } from "../useDebouncedValue";

const DELAY = 180;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useDebouncedValue", () => {
    it("returns the initial value immediately", () => {
        const { result } = renderHook(() => useDebouncedValue("abc", DELAY));
        expect(result.current).toBe("abc");
    });

    it("does not emit a new value before the delay elapses", () => {
        const { result, rerender } = renderHook(
            ({ v }) => useDebouncedValue(v, DELAY),
            { initialProps: { v: "" } }
        );
        rerender({ v: "ang" });
        // Still within the debounce window — old value stands.
        act(() => vi.advanceTimersByTime(DELAY - 1));
        expect(result.current).toBe("");
    });

    it("emits the latest value after the delay elapses", () => {
        const { result, rerender } = renderHook(
            ({ v }) => useDebouncedValue(v, DELAY),
            { initialProps: { v: "" } }
        );
        rerender({ v: "ang" });
        act(() => vi.advanceTimersByTime(DELAY));
        expect(result.current).toBe("ang");
    });

    it("collapses rapid changes into a single trailing emission", () => {
        const { result, rerender } = renderHook(
            ({ v }) => useDebouncedValue(v, DELAY),
            { initialProps: { v: "" } }
        );
        // Simulate fast typing: each keystroke restarts the timer.
        rerender({ v: "a" });
        act(() => vi.advanceTimersByTime(50));
        rerender({ v: "an" });
        act(() => vi.advanceTimersByTime(50));
        rerender({ v: "ang" });
        act(() => vi.advanceTimersByTime(50));
        // No emission yet — none of the intermediate values settled.
        expect(result.current).toBe("");
        // After the window finally clears, only the final value lands.
        act(() => vi.advanceTimersByTime(DELAY));
        expect(result.current).toBe("ang");
    });

    it("clears promptly without waiting out the delay", () => {
        const { result, rerender } = renderHook(
            ({ v }) => useDebouncedValue(v, DELAY),
            { initialProps: { v: "ang" } }
        );
        // Establish a settled non-empty value first.
        act(() => vi.advanceTimersByTime(DELAY));
        expect(result.current).toBe("ang");
        // Clearing bypasses the debounce entirely.
        rerender({ v: "" });
        expect(result.current).toBe("");
    });

    it("does not flash the previously-settled value when typing resumes after a clear", () => {
        const { result, rerender } = renderHook(
            ({ v }) => useDebouncedValue(v, DELAY),
            { initialProps: { v: "" } }
        );
        rerender({ v: "ang" });
        act(() => vi.advanceTimersByTime(DELAY));
        expect(result.current).toBe("ang");

        // Clear, let the internal reset tick fire.
        rerender({ v: "" });
        act(() => vi.advanceTimersByTime(0));
        expect(result.current).toBe("");

        // Resume typing: within the debounce window the stale "ang" must NOT
        // reappear — the box debounces from a clean base.
        rerender({ v: "b" });
        act(() => vi.advanceTimersByTime(DELAY - 1));
        expect(result.current).toBe("");
        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toBe("b");
    });

    it("a clear cancels a pending trailing emission", () => {
        const { result, rerender } = renderHook(
            ({ v }) => useDebouncedValue(v, DELAY),
            { initialProps: { v: "" } }
        );
        rerender({ v: "ang" });
        act(() => vi.advanceTimersByTime(50));
        // Clear before the pending "ang" emission would have fired.
        rerender({ v: "" });
        expect(result.current).toBe("");
        // The stale "ang" timer must not resurrect after the original delay.
        act(() => vi.advanceTimersByTime(DELAY));
        expect(result.current).toBe("");
    });
});
