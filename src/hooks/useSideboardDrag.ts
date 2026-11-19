import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
} from "react";
import type { SideboardDrag, SideboardZone } from "~/lib/sideboard-pool";

export type { SideboardDrag };
import { LONG_PRESS_THRESHOLD_MS } from "./useLongPress";

/** Mouse / pen travel before a press becomes a drag; a shorter one stays a
 *  click. */
const MOUSE_DRAG_PX = 5;
/** Touch travel that decides the gesture: sideways = drag, else scroll. */
const TOUCH_DECIDE_PX = 8;

/** The drop target under a point: any element carrying `data-drop-zone`;
 *  one also carrying `data-drop-all` moves every copy. */
function hitTest(
    x: number,
    y: number
): { zone: SideboardZone | null; all: boolean } {
    const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-drop-zone]");
    const zone = (el?.dataset.dropZone as SideboardZone | undefined) ?? null;
    return { zone, all: el?.dataset.dropAll !== undefined };
}

/**
 * Pointer-driven card drag for the Sideboarding window (issue #9820), both
 * ways between Maindeck and Sideboard. Pointer events, not HTML5 DnD: one code
 * path for mouse, pen and touch, and a custom floating card.
 *
 * - mouse / pen: the drag starts after {@link MOUSE_DRAG_PX} of travel; a
 *   plain click stays a click.
 * - touch: a SIDEWAYS swipe lifts the card (the zones sit side by side, so the
 *   move is horizontal); a vertical swipe stays a scroll — the tile carries
 *   `touch-action: pan-y`, so the browser pans vertically and hands
 *   horizontal motion to us. A hold of {@link LONG_PRESS_THRESHOLD_MS} (the
 *   board's long-press) calls `onLongPress` instead.
 * - Shift while dragging = every copy; Escape cancels; a drop outside a zone,
 *   or back on the zone it came from, does nothing.
 *
 * `suppressClick` is true for the click that follows a drag or a long-press,
 * so the release does not also tap-move a copy.
 */
export default function useSideboardDrag(
    onDrop: (cardId: string, to: SideboardZone, all: boolean) => void,
    onLongPress: (cardId: string) => void
) {
    const [drag, setDrag] = useState<SideboardDrag | null>(null);
    const dragRef = useRef<SideboardDrag | null>(null);
    const handlers = useRef({ onDrop, onLongPress });
    const suppressClick = useRef(false);
    const teardown = useRef<(() => void) | null>(null);
    useEffect(() => {
        handlers.current = { onDrop, onLongPress };
    });
    // A gesture alive at unmount must not leave window listeners behind.
    useEffect(() => () => teardown.current?.(), []);

    const update = (d: SideboardDrag | null) => {
        dragRef.current = d;
        setDrag(d);
    };
    const swallowNextClick = () => {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
    };

    const start = useCallback(
        (e: ReactPointerEvent, cardId: string, from: SideboardZone) => {
            if (e.button !== 0) return;
            teardown.current?.();
            const x0 = e.clientX;
            const y0 = e.clientY;
            const touch = e.pointerType === "touch";
            let active = false;
            let held = false;
            let timer: number | undefined;

            const place = (x: number, y: number, shift: boolean) => {
                const h = hitTest(x, y);
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
                window.clearTimeout(timer);
                navigator.vibrate?.(10);
                place(x, y, shift);
            };
            const move = (ev: PointerEvent) => {
                if (held) return;
                if (active) {
                    place(ev.clientX, ev.clientY, ev.shiftKey);
                    return;
                }
                const dx = Math.abs(ev.clientX - x0);
                const dy = Math.abs(ev.clientY - y0);
                if (touch) {
                    if (dx > TOUCH_DECIDE_PX && dx > dy)
                        begin(ev.clientX, ev.clientY, false);
                    else if (Math.hypot(dx, dy) > TOUCH_DECIDE_PX) cleanup();
                    return;
                }
                if (Math.hypot(dx, dy) >= MOUSE_DRAG_PX)
                    begin(ev.clientX, ev.clientY, ev.shiftKey);
            };
            const up = (ev: PointerEvent) => {
                cleanup();
                if (held) {
                    swallowNextClick();
                    return;
                }
                if (!active) return;
                const h = hitTest(ev.clientX, ev.clientY);
                if (h.zone && h.zone !== from)
                    handlers.current.onDrop(
                        cardId,
                        h.zone,
                        h.all || ev.shiftKey || !!dragRef.current?.shift
                    );
                swallowNextClick();
                update(null);
            };
            const cancel = () => {
                cleanup();
                if (active) update(null);
            };
            const key = (ev: KeyboardEvent) => {
                if (!active) return;
                if (ev.key === "Escape") {
                    // Esc cancels the drag, never the dialog under it.
                    ev.preventDefault();
                    ev.stopPropagation();
                    cancel();
                    return;
                }
                const cur = dragRef.current;
                if (ev.key === "Shift" && cur)
                    update({ ...cur, shift: ev.type === "keydown" });
            };
            // A lifted card must not scroll the sheet under the finger.
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
                teardown.current = null;
            };

            if (touch)
                timer = window.setTimeout(() => {
                    held = true;
                    navigator.vibrate?.(10);
                    handlers.current.onLongPress(cardId);
                }, LONG_PRESS_THRESHOLD_MS);
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", cancel);
            window.addEventListener("keydown", key, true);
            window.addEventListener("keyup", key, true);
            window.addEventListener("touchmove", touchMove, { passive: false });
            teardown.current = cancel;
        },
        []
    );

    return { drag, start, suppressClick };
}
