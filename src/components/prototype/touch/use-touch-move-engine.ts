// PROTOTYPE — throwaway. The ONE gesture engine behind every surface of
// /prototype/touch, parameterised by the #G1 gesture model under test:
//
//   A  long-press = drag (250ms hold, then move; a quick swipe scrolls)
//   B  no drag on touch — tap selects, second tap on a destination moves
//   C  drag handle — tap selects, a grip appears; dragging the grip moves
//
// Mouse always drags after 8px (all models). Hand-rolled pointer events rather
// than dnd-kit so the activation rules are explicit and the log can say WHY a
// gesture resolved the way it did (the whole point of the prototype).
import { useCallback, useEffect, useRef, useState } from "react";

export type GestureModel = "A" | "B" | "C";

export const GESTURE_MODELS: { key: GestureModel; name: string }[] = [
    { key: "A", name: "Long-press drag" },
    { key: "B", name: "Two-tap (no touch drag)" },
    { key: "C", name: "Drag handle" },
];

export interface DragState {
    key: string;
    x: number;
    y: number;
    over: string | null;
}

interface Pending {
    key: string;
    pointerId: number;
    pointerType: string;
    x0: number;
    y0: number;
    moved: boolean;
    fromHandle: boolean;
    timer: number | null;
    t0: number;
}

export interface EngineOptions {
    model: GestureModel;
    /** A drag (or two-tap) resolved onto `dropId`. */
    onMove: (key: string, dropId: string) => void;
    /** A plain tap: select/deselect. */
    onSelect: (key: string | null) => void;
    /** Hold-preview (models B/C): open/close the big card. */
    onPreview: (key: string | null) => void;
    log: (line: string) => void;
}

const HOLD_DRAG_MS = 250;
const HOLD_PREVIEW_MS = 400;
const MOVE_TOLERANCE_PX = 10;
const MOUSE_DRAG_PX = 8;

function dropIdAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y);
    const zone = el?.closest<HTMLElement>("[data-drop]");
    return zone?.dataset.drop ?? null;
}

export function useTouchMoveEngine(opts: EngineOptions) {
    const { model } = opts;
    const optsRef = useRef(opts);
    useEffect(() => {
        optsRef.current = opts;
    });
    const pending = useRef<Pending | null>(null);
    const [drag, setDrag] = useState<DragState | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const selectedRef = useRef<string | null>(null);
    const previewing = useRef(false);

    const setSel = useCallback((k: string | null) => {
        selectedRef.current = k;
        setSelected(k);
        optsRef.current.onSelect(k);
    }, []);

    const clearTimer = () => {
        if (pending.current?.timer) {
            window.clearTimeout(pending.current.timer);
            pending.current.timer = null;
        }
    };

    // During an active drag, touchmove must be cancelled (non-passive) or the
    // browser starts scrolling and fires pointercancel.
    const preventTouch = useCallback((e: TouchEvent) => {
        if (dragRef.current) e.preventDefault();
    }, []);

    const endDrag = useCallback(
        (x: number, y: number, cancelled: boolean) => {
            const d = dragRef.current;
            dragRef.current = null;
            setDrag(null);
            document.removeEventListener("touchmove", preventTouch);
            if (!d) return;
            const over = cancelled ? null : dropIdAt(x, y);
            if (over) {
                optsRef.current.log(`drop → ${over}`);
                optsRef.current.onMove(d.key, over);
            } else {
                optsRef.current.log(
                    cancelled ? "drag cancelled" : "drop outside — no move"
                );
            }
        },
        [preventTouch]
    );

    const startDrag = useCallback(
        (key: string, x: number, y: number, why: string) => {
            clearTimer();
            const d = { key, x, y, over: null };
            dragRef.current = d;
            setDrag(d);
            document.addEventListener("touchmove", preventTouch, {
                passive: false,
            });
            navigator.vibrate?.(12);
            optsRef.current.log(`drag start (${why})`);
        },
        [preventTouch]
    );

    useEffect(() => {
        const move = (e: PointerEvent) => {
            const p = pending.current;
            if (dragRef.current) {
                const over = dropIdAt(e.clientX, e.clientY);
                const d = {
                    ...dragRef.current,
                    x: e.clientX,
                    y: e.clientY,
                    over,
                };
                dragRef.current = d;
                setDrag(d);
                return;
            }
            if (!p || e.pointerId !== p.pointerId) return;
            const dx = e.clientX - p.x0;
            const dy = e.clientY - p.y0;
            const dist = Math.hypot(dx, dy);
            if (p.pointerType === "mouse") {
                if (dist > MOUSE_DRAG_PX)
                    startDrag(p.key, e.clientX, e.clientY, "mouse 8px");
                return;
            }
            if (!p.moved && dist > MOVE_TOLERANCE_PX) {
                p.moved = true;
                if (p.fromHandle) {
                    startDrag(p.key, e.clientX, e.clientY, "handle");
                } else if (p.timer) {
                    clearTimer();
                    optsRef.current.log(
                        `moved ${Math.round(dist)}px before ${model === "A" ? HOLD_DRAG_MS : HOLD_PREVIEW_MS}ms → scroll`
                    );
                }
            }
        };
        const up = (e: PointerEvent) => {
            const p = pending.current;
            if (dragRef.current) {
                endDrag(e.clientX, e.clientY, e.type === "pointercancel");
                pending.current = null;
                return;
            }
            if (!p || e.pointerId !== p.pointerId) return;
            clearTimer();
            pending.current = null;
            if (previewing.current) {
                previewing.current = false;
                optsRef.current.onPreview(null);
                optsRef.current.log("preview closed (release)");
                return;
            }
            if (e.type === "pointercancel") {
                optsRef.current.log(
                    "pointercancel (browser took the gesture: scroll)"
                );
                return;
            }
            if (!p.moved) {
                const held = Math.round(performance.now() - p.t0);
                if (selectedRef.current === p.key) {
                    setSel(null);
                    optsRef.current.log(`tap ${held}ms → deselect`);
                } else {
                    setSel(p.key);
                    optsRef.current.log(`tap ${held}ms → select`);
                }
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            window.removeEventListener("pointercancel", up);
        };
    }, [endDrag, model, setSel, startDrag]);

    const down = useCallback(
        (key: string, e: React.PointerEvent, fromHandle: boolean) => {
            if (e.button !== 0) return;
            if (dragRef.current) return;
            clearTimer();
            const p: Pending = {
                key,
                pointerId: e.pointerId,
                pointerType: e.pointerType,
                x0: e.clientX,
                y0: e.clientY,
                moved: false,
                fromHandle,
                timer: null,
                t0: performance.now(),
            };
            pending.current = p;
            if (e.pointerType === "mouse") return;
            if (fromHandle) {
                // C: the grip drags immediately — touch-action:none on the grip
                // keeps the browser from scrolling on it.
                startDrag(key, e.clientX, e.clientY, "handle press");
                return;
            }
            if (model === "A") {
                p.timer = window.setTimeout(() => {
                    if (pending.current === p && !p.moved)
                        startDrag(key, p.x0, p.y0, `held ${HOLD_DRAG_MS}ms`);
                }, HOLD_DRAG_MS);
            } else {
                p.timer = window.setTimeout(() => {
                    if (pending.current === p && !p.moved) {
                        previewing.current = true;
                        optsRef.current.onPreview(key);
                        optsRef.current.log(
                            `held ${HOLD_PREVIEW_MS}ms → preview (hold)`
                        );
                    }
                }, HOLD_PREVIEW_MS);
            }
        },
        [model, startDrag]
    );

    /** Props for a card tile. */
    const cardProps = useCallback(
        (key: string) => ({
            "data-card": key,
            onPointerDown: (e: React.PointerEvent) => down(key, e, false),
            onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
            style: {
                touchAction: "pan-x pan-y",
                WebkitTouchCallout: "none",
                userSelect: "none",
            } as React.CSSProperties,
        }),
        [down]
    );

    /** Props for the C-model grip. */
    const handleProps = useCallback(
        (key: string) => ({
            onPointerDown: (e: React.PointerEvent) => {
                e.stopPropagation();
                down(key, e, true);
            },
            style: { touchAction: "none" } as React.CSSProperties,
        }),
        [down]
    );

    /** Props for a drop zone. In model B a tap on a zone moves the selection. */
    const zoneProps = useCallback(
        (dropId: string) => ({
            "data-drop": dropId,
            onClick: (e: React.MouseEvent) => {
                if (model !== "B") return;
                // a tap ON a card is a select, not a destination tap
                if ((e.target as HTMLElement).closest("[data-card]")) return;
                const k = selectedRef.current;
                if (!k) return;
                optsRef.current.log(`two-tap → ${dropId}`);
                optsRef.current.onMove(k, dropId);
            },
        }),
        [model]
    );

    const clearSelection = useCallback(() => setSel(null), [setSel]);

    return {
        drag,
        selected,
        cardProps,
        handleProps,
        zoneProps,
        clearSelection,
        select: setSel,
    };
}
