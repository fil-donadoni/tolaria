import { useCallback, useEffect, useRef, useState } from "react";

// Desktop right-button preview gesture (Arena-style click model). Mouse-only,
// parallel to `useLongPress` (which stays touch-only). Turns a right-button
// press/hold/release into two distinct intents:
//   quick right-click (release < threshold) → toggle the anchored preview
//   right-button held past threshold        → show the big dock zoom while held
//
// State machine: idle → pressing → zoom.
//   pressing  right button down, hold timer running.
//   zoom      threshold elapsed, `onZoomStart` fired; the big preview is up and
//             stays up until release (`onZoomEnd`).
//
// Driven by POINTER events, not mouse events. Draggable ancestors (@dnd-kit's
// pointer sensor in the deck-builder, and any element that calls
// `preventDefault()` on `pointerdown`) suppress the legacy mouse-compat events
// (`mousedown`/`mouseup`), so a `mousedown`-based gesture silently dies over a
// draggable card. `pointerdown`/`pointerup` are the primitive dnd-kit itself
// listens on and always fire. Release is listened on `window` (not the element)
// because the pointer can be dragged off the card before the button comes up.
export const RIGHT_HOLD_ZOOM_MS = 250;

export type RightPressPhase = "idle" | "pressing" | "zoom";

export type UseRightPressPreviewOptions = {
    /** Quick right-click: press released before the hold threshold. */
    onQuickClick?: () => void;
    /** Hold threshold elapsed — open the big zoom. */
    onZoomStart?: () => void;
    /** Held button released (or window blurred) while zoomed — close it. */
    onZoomEnd?: () => void;
    threshold?: number;
};

export type UseRightPressPreviewResult = {
    phase: RightPressPhase;
    handlers: {
        onPointerDown: (e: React.PointerEvent) => void;
    };
};

export function useRightPressPreview(
    options: UseRightPressPreviewOptions = {}
): UseRightPressPreviewResult {
    const { threshold = RIGHT_HOLD_ZOOM_MS } = options;

    const [phase, setPhase] = useState<RightPressPhase>("idle");
    const phaseRef = useRef<RightPressPhase>("idle");
    const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Latest callbacks read from a stable ref so the window listeners and the
    // hold timer never capture stale closures. Synced in an effect (a ref must
    // not be written during render).
    const cbRef = useRef(options);
    useEffect(() => {
        cbRef.current = options;
    });

    const setPhaseSync = useCallback((p: RightPressPhase) => {
        phaseRef.current = p;
        setPhase(p);
    }, []);

    const clearHoldTimer = useCallback(() => {
        if (holdTimerRef.current !== null) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
    }, []);

    // Detach the transient window listeners bound for the duration of a press.
    const teardownRef = useRef<(() => void) | null>(null);
    const teardown = useCallback(() => {
        teardownRef.current?.();
        teardownRef.current = null;
    }, []);

    const reset = useCallback(() => {
        clearHoldTimer();
        teardown();
        setPhaseSync("idle");
    }, [clearHoldTimer, teardown, setPhaseSync]);

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            // Right button only; left-click / touch / pen stay gameplay actions.
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopPropagation();
            // A press already in flight (should not happen — pointerup resets)
            // is superseded cleanly.
            clearHoldTimer();
            teardown();
            setPhaseSync("pressing");

            const onUp = () => {
                const current = phaseRef.current;
                clearHoldTimer();
                teardown();
                setPhaseSync("idle");
                if (current === "pressing") {
                    cbRef.current.onQuickClick?.();
                } else if (current === "zoom") {
                    cbRef.current.onZoomEnd?.();
                }
            };
            // Pointer cancellation (browser gesture takeover) or losing the
            // window mid-hold must not leave the zoom stuck open.
            const onAbort = () => {
                const current = phaseRef.current;
                clearHoldTimer();
                teardown();
                setPhaseSync("idle");
                if (current === "zoom") {
                    cbRef.current.onZoomEnd?.();
                }
            };
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onAbort);
            window.addEventListener("blur", onAbort);
            teardownRef.current = () => {
                window.removeEventListener("pointerup", onUp);
                window.removeEventListener("pointercancel", onAbort);
                window.removeEventListener("blur", onAbort);
            };

            holdTimerRef.current = setTimeout(() => {
                holdTimerRef.current = null;
                setPhaseSync("zoom");
                cbRef.current.onZoomStart?.();
            }, threshold);
        },
        [threshold, clearHoldTimer, teardown, setPhaseSync]
    );

    // Cleanup on unmount: kill any pending timer + listeners.
    useEffect(() => reset, [reset]);

    return { phase, handlers: { onPointerDown } };
}
