import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
    useLongPress,
    LONG_PRESS_THRESHOLD_MS,
    PEEK_LOCK_THRESHOLD_MS,
    PRESS_SCALE,
} from "../useLongPress";

function makeTouch(x: number, y: number): React.TouchEvent {
    return {
        touches: [{ clientX: x, clientY: y }],
        preventDefault: vi.fn(),
    } as unknown as React.TouchEvent;
}

describe("useLongPress", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("starts in idle phase", () => {
        const { result } = renderHook(() => useLongPress());
        expect(result.current.phase).toBe("idle");
    });

    describe("tap (quick touch)", () => {
        it("calls onTap and never onLongPress", () => {
            const onTap = vi.fn();
            const onLongPress = vi.fn();
            const { result } = renderHook(() =>
                useLongPress({ onTap, onLongPress })
            );

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            expect(result.current.phase).toBe("pressing");

            act(() => result.current.handlers.onTouchEnd(makeTouch(100, 100)));
            expect(onTap).toHaveBeenCalledOnce();
            expect(onLongPress).not.toHaveBeenCalled();
            expect(result.current.phase).toBe("idle");
        });

        it("does not trigger long press even if timer would fire later", () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress({ onLongPress }));

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => result.current.handlers.onTouchEnd(makeTouch(100, 100)));
            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS + 50));

            expect(onLongPress).not.toHaveBeenCalled();
        });
    });

    describe("long press", () => {
        it("fires onLongPress after threshold", () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress({ onLongPress }));

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            expect(result.current.phase).toBe("pressing");

            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            expect(onLongPress).toHaveBeenCalledOnce();
            expect(result.current.phase).toBe("longPressed");
        });

        it("respects custom threshold", () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() =>
                useLongPress({ onLongPress, threshold: 200 })
            );

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => vi.advanceTimersByTime(199));
            expect(onLongPress).not.toHaveBeenCalled();

            act(() => vi.advanceTimersByTime(1));
            expect(onLongPress).toHaveBeenCalledOnce();
        });
    });

    describe("move cancellation", () => {
        it("cancels on movement >10px", () => {
            const onLongPress = vi.fn();
            const onTap = vi.fn();
            const { result } = renderHook(() =>
                useLongPress({ onLongPress, onTap })
            );

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => result.current.handlers.onTouchMove(makeTouch(100, 115)));
            expect(result.current.phase).toBe("idle");

            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS + 50));
            expect(onLongPress).not.toHaveBeenCalled();
            expect(onTap).not.toHaveBeenCalled();
        });

        it("does not cancel on small movement", () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() => useLongPress({ onLongPress }));

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => result.current.handlers.onTouchMove(makeTouch(105, 105)));
            expect(result.current.phase).toBe("pressing");

            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            expect(onLongPress).toHaveBeenCalledOnce();
        });

        it("respects custom moveCancel threshold", () => {
            const onLongPress = vi.fn();
            const { result } = renderHook(() =>
                useLongPress({ onLongPress, moveCancel: 5 })
            );

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => result.current.handlers.onTouchMove(makeTouch(106, 100)));
            expect(result.current.phase).toBe("idle");
        });
    });

    describe("peek dismiss (release within the peek window)", () => {
        it("closes the preview when the finger lifts before lock", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            expect(result.current.phase).toBe("longPressed");

            // Release partway through the peek window → peek dismiss.
            act(() => vi.advanceTimersByTime(PEEK_LOCK_THRESHOLD_MS - 100));
            const touchEnd = makeTouch(100, 100);
            act(() => result.current.handlers.onTouchEnd(touchEnd));
            expect(result.current.phase).toBe("idle");
            expect(touchEnd.preventDefault).toHaveBeenCalled();
        });

        it("does not lock after a peek dismiss even once the timer would fire", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            act(() => result.current.handlers.onTouchEnd(makeTouch(100, 100)));
            expect(result.current.phase).toBe("idle");

            act(() => vi.advanceTimersByTime(PEEK_LOCK_THRESHOLD_MS + 50));
            expect(result.current.phase).toBe("idle");
        });
    });

    describe("lock (hold past the peek window)", () => {
        it("transitions to locked after the peek threshold", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            expect(result.current.phase).toBe("longPressed");

            act(() => vi.advanceTimersByTime(PEEK_LOCK_THRESHOLD_MS));
            expect(result.current.phase).toBe("locked");
        });

        it("stays locked after the finger lifts", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            act(() => vi.advanceTimersByTime(PEEK_LOCK_THRESHOLD_MS));
            expect(result.current.phase).toBe("locked");

            const touchEnd = makeTouch(100, 100);
            act(() => result.current.handlers.onTouchEnd(touchEnd));
            expect(result.current.phase).toBe("locked");
            expect(touchEnd.preventDefault).toHaveBeenCalled();
        });

        it("dismiss() closes a locked preview", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            act(() => vi.advanceTimersByTime(PEEK_LOCK_THRESHOLD_MS));
            expect(result.current.phase).toBe("locked");

            act(() => result.current.dismiss());
            expect(result.current.phase).toBe("idle");
        });
    });

    describe("touchCancel", () => {
        it("resets to idle", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => result.current.handlers.onTouchCancel());
            expect(result.current.phase).toBe("idle");
        });
    });

    describe("scaleStyle", () => {
        it("applies scale during pressing phase", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            expect(result.current.scaleStyle.transform).toBe(
                `scale(${PRESS_SCALE})`
            );
        });

        it("removes scale in idle phase", () => {
            const { result } = renderHook(() => useLongPress());
            expect(result.current.scaleStyle.transform).toBe("scale(1)");
        });

        it("removes scale after long press fires", () => {
            const { result } = renderHook(() => useLongPress());

            act(() =>
                result.current.handlers.onTouchStart(makeTouch(100, 100))
            );
            act(() => vi.advanceTimersByTime(LONG_PRESS_THRESHOLD_MS));
            expect(result.current.scaleStyle.transform).toBe("scale(1)");
        });
    });
});
