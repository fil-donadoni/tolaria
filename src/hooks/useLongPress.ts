import { useCallback, useRef, useState } from "react";

export const LONG_PRESS_THRESHOLD_MS = 400;
export const LONG_PRESS_CANCEL_PX = 10;
export const PEEK_LOCK_THRESHOLD_MS = 1000;
export const PRESS_SCALE = 1.05;

// State machine (touch gesture, ADR 0009):
//   idle → pressing → longPressed → locked
// `pressing`     finger down, long-press timer running (scale feedback shown).
// `longPressed`  threshold elapsed, preview open, peek window running. Release
//                here = peek dismiss (preview closes).
// `locked`       finger held past the peek window; preview stays open after
//                release and must be dismissed explicitly (backdrop tap).
export type LongPressPhase = "idle" | "pressing" | "longPressed" | "locked";

export type UseLongPressOptions = {
    onLongPress?: () => void;
    onTap?: () => void;
    threshold?: number;
    moveCancel?: number;
    /** Hold time after `onLongPress` fires before the preview locks open
     *  (CR-agnostic UX). Release before this → peek (closes); after → lock. */
    peekLock?: number;
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
        peekLock = PEEK_LOCK_THRESHOLD_MS,
    } = options;

    const [phase, setPhase] = useState<LongPressPhase>("idle");
    const phaseRef = useRef<LongPressPhase>("idle");
    // Long-press timer (pressing → longPressed) and the peek-window timer
    // (longPressed → locked) are tracked separately so each can be cancelled
    // independently (a peek dismiss must kill a still-pending lock timer).
    const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startPos = useRef({ x: 0, y: 0 });

    const clearTimers = useCallback(() => {
        if (pressTimerRef.current !== null) {
            clearTimeout(pressTimerRef.current);
            pressTimerRef.current = null;
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
            // A locked preview owns the screen via its backdrop — a fresh
            // press shouldn't restart the machine until it's dismissed.
            if (phaseRef.current === "locked") return;
            const touch = e.touches[0];
            startPos.current = { x: touch.clientX, y: touch.clientY };
            setPhaseSync("pressing");
            clearTimers();

            pressTimerRef.current = setTimeout(() => {
                pressTimerRef.current = null;
                setPhaseSync("longPressed");
                onLongPress?.();
                // Start the peek window: hold past it to lock the preview open.
                lockTimerRef.current = setTimeout(() => {
                    lockTimerRef.current = null;
                    setPhaseSync("locked");
                }, peekLock);
            }, threshold);
        },
        [onLongPress, threshold, peekLock, clearTimers, setPhaseSync]
    );

    const onTouchMove = useCallback(
        (e: React.TouchEvent) => {
            // Only an in-progress press cancels on scroll; once the preview is
            // open (longPressed/locked) finger drift shouldn't close it.
            if (phaseRef.current !== "pressing") return;
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
                clearTimers();
                setPhaseSync("idle");
                onTap?.();
                return;
            }
            // Peek dismiss: released within the peek window → close the
            // preview (the lock timer is still pending, cancel it).
            if (current === "longPressed") {
                e.preventDefault();
                clearTimers();
                setPhaseSync("idle");
                return;
            }
            // Locked: finger lift leaves the preview open; dismissal is an
            // explicit backdrop tap routed through `dismiss()`.
            if (current === "locked") {
                e.preventDefault();
                return;
            }
        },
        [onTap, clearTimers, setPhaseSync]
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
