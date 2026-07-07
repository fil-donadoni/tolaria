import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
    useRightPressPreview,
    RIGHT_HOLD_ZOOM_MS,
} from "../useRightPressPreview";

function makePointer(button: number): React.PointerEvent {
    return {
        button,
        pointerType: "mouse",
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
    } as unknown as React.PointerEvent;
}

function releaseButton() {
    window.dispatchEvent(new Event("pointerup"));
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

        const e = makePointer(0); // left button
        act(() => result.current.handlers.onPointerDown(e));

        expect(result.current.phase).toBe("idle");
        expect(e.preventDefault).not.toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS + 50));
        expect(onZoomStart).not.toHaveBeenCalled();
    });

    it("suppresses default + propagation on right press", () => {
        const { result } = renderHook(() => useRightPressPreview());
        const e = makePointer(2);
        act(() => result.current.handlers.onPointerDown(e));
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

            act(() => result.current.handlers.onPointerDown(makePointer(2)));
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
            act(() => result.current.handlers.onPointerDown(makePointer(2)));
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

            act(() => result.current.handlers.onPointerDown(makePointer(2)));
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

            act(() => result.current.handlers.onPointerDown(makePointer(2)));
            act(() => vi.advanceTimersByTime(RIGHT_HOLD_ZOOM_MS));
            act(() => window.dispatchEvent(new Event("blur")));

            expect(onZoomEnd).toHaveBeenCalledOnce();
            expect(result.current.phase).toBe("idle");
        });
    });

    // The native "Save image…" menu must never win over the preview. A card
    // React `onContextMenu` can't cancel it on the spatial board (CardTilt3D's
    // preserve-3d flattening retargets the event; the preview is a body portal),
    // so the hook eats the one contextmenu each right-press produces via a
    // one-shot capture-phase document listener, regardless of its target.
    describe("native context menu suppression", () => {
        function fireContextMenu(): MouseEvent {
            const ev = new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
            });
            act(() => {
                document.dispatchEvent(ev);
            });
            return ev;
        }

        it("eats the contextmenu that follows a right press, wherever it targets", () => {
            const { result } = renderHook(() => useRightPressPreview());
            act(() => result.current.handlers.onPointerDown(makePointer(2)));
            // The native menu fires on document, not the card element.
            const ev = fireContextMenu();
            expect(ev.defaultPrevented).toBe(true);
            act(() => releaseButton());
        });

        it("does not touch a contextmenu with no preceding right press", () => {
            renderHook(() => useRightPressPreview());
            const ev = fireContextMenu();
            expect(ev.defaultPrevented).toBe(false);
        });

        it("suppresses only ONE contextmenu per right press", () => {
            const { result } = renderHook(() => useRightPressPreview());
            act(() => result.current.handlers.onPointerDown(makePointer(2)));
            const first = fireContextMenu();
            const second = fireContextMenu();
            expect(first.defaultPrevented).toBe(true);
            expect(second.defaultPrevented).toBe(false);
            act(() => releaseButton());
        });

        it("drops the suppressor after the fallback window if no menu follows", () => {
            const { result } = renderHook(() => useRightPressPreview());
            act(() => result.current.handlers.onPointerDown(makePointer(2)));
            act(() => {
                releaseButton();
                vi.advanceTimersByTime(700);
            });
            // A later, unrelated right-click's menu must NOT be swallowed.
            const ev = fireContextMenu();
            expect(ev.defaultPrevented).toBe(false);
        });

        it("a left press installs no suppressor", () => {
            const { result } = renderHook(() => useRightPressPreview());
            act(() => result.current.handlers.onPointerDown(makePointer(0)));
            const ev = fireContextMenu();
            expect(ev.defaultPrevented).toBe(false);
        });
    });
});
