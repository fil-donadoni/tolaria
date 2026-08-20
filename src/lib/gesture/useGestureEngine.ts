import { useCallback, useEffect, useRef, useState } from "react";
import {
    gestureReducer,
    INITIAL_GESTURE_STATE,
    type GestureEffect,
    type GestureInput,
    type GesturePointerKind,
    type GestureState,
} from "./activation";
import { dropIdAt } from "./drop-targets";

/** The live drag, as the surface needs to render it: which card, where the
 *  finger is (for the ghost), and which `[data-drop]` region it is over (for
 *  the highlight). */
export interface GestureDrag {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly over: string | null;
}

export interface GestureEngineOptions {
    /** A press resolved as a tap: select the card (→ Peek Panel). */
    onSelect: (key: string) => void;
    /** A drag ended over a `[data-drop]` region. `dropId` is verbatim the
     *  attribute value the surface put there — the engine never parses it. */
    onMove: (key: string, dropId: string) => void;
    /** The drag became live (haptic already fired). */
    onDragStart?: (key: string) => void;
    /** The drag ended over nothing, or the browser cancelled it. */
    onDragCancel?: (key: string) => void;
    /** The press yielded to native scrolling. */
    onScroll?: (key: string) => void;
}

export interface GestureEngine {
    /** Non-null while a drag is live — render {@link GestureDragGhost}. */
    readonly drag: GestureDrag | null;
    /** Spread onto a draggable card. The surface still owns its own
     *  `touch-action`: which axis may scroll is a property of the SURFACE
     *  (a horizontally-scrolling MV row is `touch-pan-x`), and forcing it
     *  from here would re-break the swipe-on-a-card scroll that ADR 0009 /
     *  issue #1994 exist to protect. */
    readonly cardProps: (key: string) => {
        onPointerDown: (event: React.PointerEvent) => void;
        onContextMenu: (event: React.MouseEvent) => void;
        style: React.CSSProperties;
    };
}

/** Haptic tick when the hold promotes to a drag — the only feedback a finger
 *  gets that the card is now attached to it. */
const DRAG_START_VIBRATION_MS = 12;

function pointerKindOf(pointerType: string): GesturePointerKind {
    return pointerType === "mouse"
        ? "mouse"
        : pointerType === "pen"
          ? "pen"
          : "touch";
}

/**
 * The editing-surface gesture engine: real pointer events in, surface
 * callbacks out, with {@link gestureReducer} making every activation
 * decision. The hook owns only plumbing a pure function cannot — the hold
 * timer, the ghost position, `elementFromPoint` drop resolution, the
 * non-passive `touchmove` block that keeps the browser from scrolling
 * mid-drag, and the haptic.
 *
 * dnd-kit remains the drag TRANSPORT on the deckbuilder surfaces that already
 * use it; its activation thresholds are configured from the same constants
 * this reducer decides by (`useDeckDragSensors`), so the two can never
 * disagree about when a press becomes a drag.
 */
export function useGestureEngine(options: GestureEngineOptions): GestureEngine {
    const optionsRef = useRef(options);
    useEffect(() => {
        optionsRef.current = options;
    });

    const stateRef = useRef<GestureState>(INITIAL_GESTURE_STATE);
    const holdTimerRef = useRef<number | null>(null);
    const dragRef = useRef<GestureDrag | null>(null);
    const [drag, setDrag] = useState<GestureDrag | null>(null);
    // `dispatch` is re-entered from the hold timer, so it is reached through a
    // ref rather than a closure captured at arm time.
    const dispatchRef = useRef<(input: GestureInput) => void>(() => {});

    const clearHold = useCallback(() => {
        if (holdTimerRef.current !== null) {
            window.clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
        }
    }, []);

    // While a drag is live the browser must not also scroll: `touchmove` has
    // to be cancelled, which only a NON-PASSIVE listener may do. It is added
    // for the drag's duration only — a permanently-installed blocker would
    // kill the scroll the rest of the model depends on.
    const blockTouchScroll = useCallback((event: TouchEvent) => {
        if (dragRef.current) event.preventDefault();
    }, []);

    const setDragState = useCallback((next: GestureDrag | null) => {
        dragRef.current = next;
        setDrag(next);
    }, []);

    const runEffect = useCallback(
        (effect: GestureEffect) => {
            const opts = optionsRef.current;
            switch (effect.type) {
                case "armHold": {
                    clearHold();
                    const { pointerId } = effect;
                    holdTimerRef.current = window.setTimeout(() => {
                        holdTimerRef.current = null;
                        dispatchRef.current({
                            type: "hold",
                            pointerId,
                            t: performance.now(),
                        });
                    }, effect.delayMs);
                    return;
                }
                case "cancelHold":
                    clearHold();
                    return;
                case "dragStart":
                    setDragState({
                        key: effect.key,
                        x: effect.x,
                        y: effect.y,
                        over: null,
                    });
                    document.addEventListener("touchmove", blockTouchScroll, {
                        passive: false,
                    });
                    navigator.vibrate?.(DRAG_START_VIBRATION_MS);
                    opts.onDragStart?.(effect.key);
                    return;
                case "dragMove":
                    setDragState({
                        key: effect.key,
                        x: effect.x,
                        y: effect.y,
                        over: dropIdAt(effect.x, effect.y),
                    });
                    return;
                case "dragEnd": {
                    document.removeEventListener("touchmove", blockTouchScroll);
                    setDragState(null);
                    const over = effect.cancelled
                        ? null
                        : dropIdAt(effect.x, effect.y);
                    if (over) opts.onMove(effect.key, over);
                    else opts.onDragCancel?.(effect.key);
                    return;
                }
                case "scroll":
                    opts.onScroll?.(effect.key);
                    return;
                case "tap":
                    opts.onSelect(effect.key);
                    return;
            }
        },
        [blockTouchScroll, clearHold, setDragState]
    );

    const dispatch = useCallback(
        (input: GestureInput) => {
            const { state, effects } = gestureReducer(stateRef.current, input);
            stateRef.current = state;
            for (const effect of effects) runEffect(effect);
        },
        [runEffect]
    );
    useEffect(() => {
        dispatchRef.current = dispatch;
    }, [dispatch]);

    useEffect(() => {
        const onMove = (event: PointerEvent) =>
            dispatchRef.current({
                type: "move",
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                t: event.timeStamp,
            });
        const onUp = (event: PointerEvent) =>
            dispatchRef.current({
                type: "release",
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                t: performance.now(),
            });
        const onCancel = (event: PointerEvent) =>
            dispatchRef.current({
                type: "abort",
                pointerId: event.pointerId,
            });
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
        };
    }, []);

    // Unmounting mid-drag must not leave the non-passive blocker installed —
    // every later touch on the app would then be unscrollable.
    useEffect(() => {
        return () => {
            clearHold();
            document.removeEventListener("touchmove", blockTouchScroll);
        };
    }, [blockTouchScroll, clearHold]);

    const cardProps = useCallback(
        (key: string) => ({
            onPointerDown: (event: React.PointerEvent) => {
                if (event.button !== 0) return;
                dispatchRef.current({
                    type: "press",
                    key,
                    pointerId: event.pointerId,
                    pointerKind: pointerKindOf(event.pointerType),
                    x: event.clientX,
                    y: event.clientY,
                    t: performance.now(),
                });
            },
            // A long press on an image is the platform's "Save image…" menu;
            // here it is the drag, so the native menu must not open.
            onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
            style: {
                WebkitTouchCallout: "none",
                userSelect: "none",
            } as React.CSSProperties,
        }),
        []
    );

    return { drag, cardProps };
}
