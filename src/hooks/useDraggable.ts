import {
    useCallback,
    useRef,
    useState,
    type MouseEvent,
    type PointerEvent,
} from "react";

const DRAG_THRESHOLD = 4;

export type DragHandlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onClickCapture: (e: MouseEvent<HTMLElement>) => void;
};

export function useDraggable() {
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const drag = useRef<{
        startX: number;
        startY: number;
        originX: number;
        originY: number;
        active: boolean;
    } | null>(null);
    const justDragged = useRef(false);

    const onPointerDown = useCallback(
        (e: PointerEvent<HTMLElement>) => {
            const target = e.target as HTMLElement;
            if (target.closest("button, a, input, textarea, select")) return;
            drag.current = {
                startX: e.clientX,
                startY: e.clientY,
                originX: offset.x,
                originY: offset.y,
                active: false,
            };
        },
        [offset.x, offset.y]
    );

    const onPointerMove = useCallback((e: PointerEvent<HTMLElement>) => {
        const s = drag.current;
        if (!s) return;
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (!s.active) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            s.active = true;
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        setOffset({ x: s.originX + dx, y: s.originY + dy });
    }, []);

    const onPointerUp = useCallback((e: PointerEvent<HTMLElement>) => {
        const s = drag.current;
        if (s?.active) {
            justDragged.current = true;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
        }
        drag.current = null;
    }, []);

    const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
        if (justDragged.current) {
            e.stopPropagation();
            e.preventDefault();
            justDragged.current = false;
        }
    }, []);

    const dragHandlers: DragHandlers = {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onClickCapture,
    };

    return { offset, dragHandlers };
}
