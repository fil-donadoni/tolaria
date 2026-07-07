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
// Release is listened on `window` (not the element) because the pointer can be
// dragged off the card before the button comes up.
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
        onMouseDown: (e: React.MouseEvent) => void;
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

    const onMouseDown = useCallback(
        (e: React.MouseEvent) => {
            // Right button only; left-click stays a gameplay action.
            if (e.button !== 2) return;
            e.preventDefault();
            e.stopPropagation();
            // A press already in flight (should not happen — mouseup resets) is
            // superseded cleanly.
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
            // Losing the window mid-hold must not leave the zoom stuck open.
            const onBlur = () => {
                const current = phaseRef.current;
                clearHoldTimer();
                teardown();
                setPhaseSync("idle");
                if (current === "zoom") {
                    cbRef.current.onZoomEnd?.();
                }
            };
            window.addEventListener("mouseup", onUp);
            window.addEventListener("blur", onBlur);
            teardownRef.current = () => {
                window.removeEventListener("mouseup", onUp);
                window.removeEventListener("blur", onBlur);
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

    return { phase, handlers: { onMouseDown } };
}
