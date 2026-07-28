import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewportWidth } from "../useViewportWidth";

const setInnerWidth = (w: number) => {
    Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: w,
    });
};

describe("useViewportWidth (issue #1765)", () => {
    const originalInnerWidth = window.innerWidth;
    afterEach(() => {
        setInnerWidth(originalInnerWidth);
    });

    it("reads the live window.innerWidth on mount", () => {
        setInnerWidth(390);
        const { result } = renderHook(() => useViewportWidth());
        expect(result.current).toBe(390);
    });

    it("updates on a resize event", () => {
        setInnerWidth(1024);
        const { result } = renderHook(() => useViewportWidth());
        expect(result.current).toBe(1024);

        act(() => {
            setInnerWidth(390);
            window.dispatchEvent(new Event("resize"));
        });
        expect(result.current).toBe(390);
    });
});
