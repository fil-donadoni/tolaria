import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
    useRightPressPreview,
    RIGHT_HOLD_ZOOM_MS,
} from "../useRightPressPreview";

function makeMouse(button: number): React.MouseEvent {
    return {
        button,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
}

function releaseButton() {
    window.dispatchEvent(new MouseEvent("mouseup"));
}

describe("useRightPressPreview", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("starts in idle phase", () => {
        const { result } = renderHook(() => useRightPressPreview());
        expect(result.current.phase).toBe("idle");
    });

    it("ignores non-right buttons", () => {
        const onQuickClick = vi.fn();
        const onZoomStart = vi.fn();
        const { result } = renderHook(() =>
            useRightPressPreview({ onQuickClick, onZoomStart })
        );

        const e = makeMouse(0); // left button
        act(() => result.current.handlers.onMouseDown(e));

        expect(result.current.phase).toBe("idle");
        expect(e.preventDefault).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS + 50));
        expect(onZoomStart).not.toHaveBeenCalled();
    });

    it("suppresses default + propagation on right press", () => {
        const { result } = renderHook(() => useRightPressPreview());
        const e = makeMouse(2);
        act(() => result.current.handlers.onMouseDown(e));
        expect(e.preventDefault).toHaveBeenCalledOnce();
        expect(e.stopPropagation).toHaveBeenCalledOnce();
        act(() => releaseButton());
    });

    describe("quick right-click", () => {
        it("fires onQuickClick on release before threshold, never onZoomStart", () => {
            const onQuickClick = vi.fn();
            const onZoomStart = vi.fn();
            const { result } = renderHook(() =>
                useRightPressPreview({ onQuickClick, onZoomStart })
            );

            act(() => result.current.handlers.onMouseDown(makeMouse(2)));
            expect(result.current.phase).toBe("pressing");

            act(() => {
                vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS - 50);
                releaseButton();
            });

            expect(onQuickClick).toHaveBeenCalledOnce();
            expect(onZoomStart).not.toHaveBeenCalled();
            expect(result.current.phase).toBe("idle");
        });

        it("does not fire zoom even if the timer would fire after release", () => {
            const onZoomStart = vi.fn();
            const { result } = renderHook(() =>
                useRightPressPreview({ onZoomStart })
            );
            act(() => result.current.handlers.onMouseDown(makeMouse(2)));
            act(() => releaseButton());
            act(() => vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS + 50));
            expect(onZoomStart).not.toHaveBeenCalled();
        });
    });

    describe("hold zoom", () => {
        it("fires onZoomStart at threshold and onZoomEnd on release", () => {
            const onQuickClick = vi.fn();
            const onZoomStart = vi.fn();
            const onZoomEnd = vi.fn();
            const { result } = renderHook(() =>
                useRightPressPreview({ onQuickClick, onZoomStart, onZoomEnd })
            );

            act(() => result.current.handlers.onMouseDown(makeMouse(2)));
            act(() => vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS));
            expect(onZoomStart).toHaveBeenCalledOnce();
            expect(result.current.phase).toBe("zoom");

            act(() => releaseButton());
            expect(onZoomEnd).toHaveBeenCalledOnce();
            expect(onQuickClick).not.toHaveBeenCalled();
            expect(result.current.phase).toBe("idle");
        });

        it("closes the zoom on window blur", () => {
            const onZoomEnd = vi.fn();
            const { result } = renderHook(() =>
                useRightPressPreview({ onZoomEnd })
            );

            act(() => result.current.handlers.onMouseDown(makeMouse(2)));
            act(() => vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS));
            act(() => window.dispatchEvent(new Event("blur")));

            expect(onZoomEnd).toHaveBeenCalledOnce();
            expect(result.current.phase).toBe("idle");
        });
    });
});
