import { useCallback, useRef, useState } from "react";

export const LONG_PRESS_THRESHOLD_MS = 400;
export const LONG_PRESS_CANCEL_PX = 10;
export const PEEK_LOCK_THRESHOLD_MS = 1000;
export const PRESS_SCALE = 1.05;

export type LongPressPhase = "idle" | "pressing" | "longPressed" | "locked";

export type UseLongPressOptions = {
    onLongPress?: () => void;
    onTap?: () => void;
    threshold?: number;
    moveCancel?: number;
};

export type UseLongPressResult = {
    phase: LongPressPhase;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchMove: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
        onTouchCancel: () => void;
    };
    dismiss: () => void;
    scaleStyle: React.CSSProperties;
};

export function useLongPress(
    options: UseLongPressOptions = {}
): UseLongPressResult {
    const {
        onLongPress,
        onTap,
        threshold = LONG_PRESS_THRESHOLD_MS,
        moveCancel = LONG_PRESS_CANCEL_PX,
    } = options;

    const [phase, setPhase] = useState<LongPressPhase>("idle");
    const phaseRef = useRef<LongPressPhase>("idle");
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef({ x: 0, y: 0 });

    const clearTimers = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (lockTimerRef.current !== null) {
            clearTimeout(lockTimerRef.current);
            lockTimerRef.current = null;
        }
    }, []);

    const setPhaseSync = useCallback((p: LongPressPhase) => {
        phaseRef.current = p;
        setPhase(p);
    }, []);

    const reset = useCallback(() => {
        clearTimers();
        setPhaseSync("idle");
    }, [clearTimers, setPhaseSync]);

    const onTouchStart = useCallback(
        (e: React.TouchEvent) => {
            const touch = e.touches[0];
            startPos.current = { x: touch.clientX, y: touch.clientY };
            setPhaseSync("pressing");
            clearTimers();

            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                setPhaseSync("longPressed");
                onLongPress?.();

                lockTimerRef.current = setTimeout(() => {
                    lockTimerRef.current = null;
                    setPhaseSync("locked");
                }, PEEK_LOCK_THRESHOLD_MS);
            }, threshold);
        },
        [onLongPress, threshold, clearTimers, setPhaseSync]
    );

    const onTouchMove = useCallback(
        (e: React.TouchEvent) => {
            if (phaseRef.current === "idle" || phaseRef.current === "locked")
                return;
            const touch = e.touches[0];
            const dx = touch.clientX - startPos.current.x;
            const dy = touch.clientY - startPos.current.y;
            if (Math.abs(dx) > moveCancel || Math.abs(dy) > moveCancel) {
                reset();
            }
        },
        [moveCancel, reset]
    );

    const onTouchEnd = useCallback(
        (e: React.TouchEvent) => {
            const current = phaseRef.current;
            if (current === "pressing") {
                // Quick tap — didn't reach threshold
                clearTimers();
                setPhaseSync("idle");
                onTap?.();
                return;
            }
            if (current === "longPressed") {
                // Peek: release before lock threshold → close
                e.preventDefault();
                reset();
                return;
            }
            if (current === "locked") {
                // Locked: overlay stays, touch end is a no-op
                // Dismiss happens via backdrop tap (handled by dismiss())
                e.preventDefault();
                return;
            }
        },
        [onTap, clearTimers, reset, setPhaseSync]
    );

    const onTouchCancel = useCallback(() => {
        reset();
    }, [reset]);

    const dismiss = useCallback(() => {
        reset();
    }, [reset]);

    const scaleStyle: React.CSSProperties =
        phase === "pressing"
            ? {
                  transform: `scale(${PRESS_SCALE})`,
                  transition: "transform 150ms ease-out",
              }
            : { transform: "scale(1)", transition: "transform 150ms ease-out" };

    return {
        phase,
        handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
        dismiss,
        scaleStyle,
    };
}
