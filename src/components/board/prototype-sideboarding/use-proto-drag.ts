// PROTOTYPE — throwaway. Pointer-driven card drag for Variant A, both ways.
//
// Pointer events, not HTML5 DnD: one code path for mouse, pen and touch, and a
// custom floating card instead of the browser's translucent drag image.
//  - mouse / pen: drag starts after 5px of travel; a plain click stays a click.
//  - touch: a SIDEWAYS swipe on a card lifts it at once (Maindeck and
//    Sideboard sit side by side, so the move is horizontal); a vertical swipe
//    stays a scroll — the tile carries `touch-action: pan-y`, so the browser
//    pans vertically and hands horizontal motion to us without a
//    pointercancel. A long-press (400ms, the board's long-press threshold)
//    calls `onLongPress` instead — the host opens the card's Inspect Overlay.
// Drop targets are any element with `data-drop-zone="main|side"`; an element
// also carrying `data-drop-all` moves every copy. Shift while dragging = all.
import { useCallback, useEffect, useRef, useState } from "react";

export type Zone = "main" | "side";
export type DragInfo = {
    cardId: string;
    from: Zone;
    x: number;
    y: number;
    shift: boolean;
    over: Zone | null;
    overAll: boolean;
};

function hit(x: number, y: number): { zone: Zone | null; all: boolean } {
    const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-drop-zone]");
    const zone = (el?.dataset.dropZone as Zone | undefined) ?? null;
    return { zone, all: el?.dataset.dropAll !== undefined };
}

export function useProtoDrag(
    onDrop: (cardId: string, from: Zone, to: Zone, all: boolean) => void,
    onLongPress?: (cardId: string, from: Zone) => void
) {
    const [drag, setDrag] = useState<DragInfo | null>(null);
    const dragRef = useRef<DragInfo | null>(null);
    const onDropRef = useRef(onDrop);
    const onLongPressRef = useRef(onLongPress);
    const suppressClick = useRef(false);
    useEffect(() => {
        onDropRef.current = onDrop;
        onLongPressRef.current = onLongPress;
    });

    const update = (d: DragInfo | null) => {
        dragRef.current = d;
        setDrag(d);
    };

    const start = useCallback(
        (e: React.PointerEvent, cardId: string, from: Zone) => {
            if (e.button !== 0) return;
            const x0 = e.clientX;
            const y0 = e.clientY;
            const touch = e.pointerType === "touch";
            let active = false;
            let held = false; // long-press fired: this gesture is spent
            let timer: number | undefined;

            const place = (x: number, y: number, shift: boolean) => {
                const h = hit(x, y);
                update({
                    cardId,
                    from,
                    x,
                    y,
                    shift,
                    over: h.zone,
                    overAll: h.all,
                });
            };
            const begin = (x: number, y: number, shift: boolean) => {
                active = true;
                navigator.vibrate?.(10);
                place(x, y, shift);
            };
            const move = (ev: PointerEvent) => {
                if (held) return;
                if (!active) {
                    const d = Math.hypot(ev.clientX - x0, ev.clientY - y0);
                    if (touch) {
                        const dx = Math.abs(ev.clientX - x0);
                        const dy = Math.abs(ev.clientY - y0);
                        if (dx > 8 && dx > dy) {
                            window.clearTimeout(timer);
                            begin(ev.clientX, ev.clientY, false);
                        } else if (d > 8) cleanup(); // vertical: let it scroll
                        return;
                    }
                    if (d < 5) return;
                    begin(ev.clientX, ev.clientY, ev.shiftKey);
                    return;
                }
                place(ev.clientX, ev.clientY, ev.shiftKey);
            };
            const up = (ev: PointerEvent) => {
                cleanup();
                if (held) {
                    // the release of a long-press must not also tap-move
                    suppressClick.current = true;
                    window.setTimeout(() => (suppressClick.current = false), 0);
                    return;
                }
                if (!active) return;
                const h = hit(ev.clientX, ev.clientY);
                const cur = dragRef.current;
                if (h.zone && h.zone !== from)
                    onDropRef.current(
                        cardId,
                        from,
                        h.zone,
                        h.all || ev.shiftKey || !!cur?.shift
                    );
                suppressClick.current = true;
                window.setTimeout(() => (suppressClick.current = false), 0);
                update(null);
            };
            const cancel = () => {
                cleanup();
                if (active) update(null);
            };
            const key = (ev: KeyboardEvent) => {
                if (!active) return;
                if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    cancel();
                    return;
                }
                const cur = dragRef.current;
                if (ev.key === "Shift" && cur)
                    update({ ...cur, shift: ev.type === "keydown" });
            };
            // a lifted card must not scroll the sheet under the finger
            const touchMove = (ev: TouchEvent) => {
                if (active) ev.preventDefault();
            };
            const cleanup = () => {
                window.clearTimeout(timer);
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                window.removeEventListener("pointercancel", cancel);
                window.removeEventListener("keydown", key, true);
                window.removeEventListener("keyup", key, true);
                window.removeEventListener("touchmove", touchMove);
            };

            if (touch)
                timer = window.setTimeout(() => {
                    if (!onLongPressRef.current) return begin(x0, y0, false);
                    held = true;
                    navigator.vibrate?.(10);
                    onLongPressRef.current(cardId, from);
                }, 400);
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", cancel);
            window.addEventListener("keydown", key, true);
            window.addEventListener("keyup", key, true);
            window.addEventListener("touchmove", touchMove, { passive: false });
        },
        []
    );

    return { drag, start, suppressClick };
}
