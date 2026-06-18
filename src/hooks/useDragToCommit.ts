import { useCallback, useRef, useState } from "react";

/** Upward travel (px) past which a release commits. Lifting the card above this
 *  "line over the hand" and releasing fires the commit; releasing below it is a
 *  no-op return-to-hand. Tuned to clear an accidental nudge while staying within
 *  an easy flick of the hand zone. */
const COMMIT_LIFT_PX = 64;
/** Total travel (px) before a press is treated as a drag rather than a click.
 *  Below this, pointerup is a plain click and the gesture stays inert. */
const DRAG_START_PX = 6;

export type DragToCommitState = {
    /** True once the pointer has travelled past {@link DRAG_START_PX} — the card
     *  is being dragged (used to lift it visually and suppress hover tilt). */
    dragging: boolean;
    /** Live pointer offset from the press origin, in px. `{0,0}` when idle. */
    offset: { x: number; y: number };
    /** True while dragging AND lifted past the commit threshold — the release
     *  will commit. Drives the "armed" affordance. */
    armed: boolean;
};

export type DragToCommitHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
};

/** Drag-to-commit gesture for a hand card (PRD #249, slice #254, option (a)).
 *
 * A pointer drag that lifts the card above the commit line and releases fires
 * `onCommit` — the caller wires that to the SHARED commit pipeline
 * (`useHandCardCommit`), so a committed drag dispatches the exact same mutation
 * as a click. Releasing below the line returns the card to the hand and
 * dispatches nothing (no-op). A press that never passes {@link DRAG_START_PX}
 * stays a click: this gesture leaves the element's `onClick` untouched, so click
 * remains a fully valid way to play/cast.
 *
 * The gesture is pointer-capture based so it keeps tracking outside the card,
 * and it is deliberately confined to the hand — the battlefield never mounts it,
 * so battlefield cards stay click-only.
 *
 * `commitEnabled` gates whether a release can commit at all: when the card has
 * no legal play/cast action it is `false`, so dragging is inert (the card still
 * returns to hand) and no mutation can fire. */
export function useDragToCommit(opts: {
    commitEnabled: boolean;
    onCommit: (e: React.PointerEvent<HTMLElement>) => void;
}) {
    const { commitEnabled, onCommit } = opts;
    const [state, setState] = useState<DragToCommitState>({
        dragging: false,
        offset: { x: 0, y: 0 },
        armed: false,
    });
    const press = useRef<{
        startX: number;
        startY: number;
        active: boolean;
        pointerId: number;
    } | null>(null);
    // A real drag ends with a synthetic `click` on the same element. Swallow
    // that one click so a drag never ALSO fires the element's onClick commit
    // path — drag and click must each fire the mutation exactly once.
    const swallowNextClick = useRef(false);

    const reset = useCallback(() => {
        press.current = null;
        setState({ dragging: false, offset: { x: 0, y: 0 }, armed: false });
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
        // Only the primary button initiates a drag; right/middle clicks fall
        // through to context menus etc.
        if (e.button !== 0) return;
        press.current = {
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            pointerId: e.pointerId,
        };
    }, []);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const p = press.current;
        if (!p) return;
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (!p.active) {
            if (Math.hypot(dx, dy) < DRAG_START_PX) return;
            p.active = true;
            e.currentTarget.setPointerCapture(e.pointerId);
        }
        // Upward lift is negative dy; arm when lifted past the commit line.
        const armed = -dy >= COMMIT_LIFT_PX;
        setState({ dragging: true, offset: { x: dx, y: dy }, armed });
    }, []);

    const onPointerUp = useCallback(
        (e: React.PointerEvent<HTMLElement>) => {
            const p = press.current;
            if (!p) return;
            const dy = e.clientY - p.startY;
            const wasDragging = p.active;
            const lifted = -dy >= COMMIT_LIFT_PX;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
            reset();
            // A real drag suppresses the trailing synthetic click on the card
            // so it never ALSO fires the element's onClick (double commit).
            if (wasDragging) swallowNextClick.current = true;
            // Commit only on a real drag lifted past the line; a sub-threshold
            // press is left to the element's own onClick (unchanged path).
            if (wasDragging && lifted && commitEnabled) {
                onCommit(e);
            }
        },
        [commitEnabled, onCommit, reset]
    );

    const onPointerCancel = useCallback(() => {
        reset();
    }, [reset]);

    const onClickCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
        if (!swallowNextClick.current) return;
        // React bubbles portal events through the COMPONENT tree, so a click on
        // a portal'd overlay this card opened (e.g. the mode picker) would reach
        // here too. Only swallow the synthetic click on the card itself — a real
        // DOM descendant of currentTarget — and let portal clicks through so the
        // picker stays interactive after a drag.
        const target = e.target as Node;
        if (!e.currentTarget.contains(target)) return;
        swallowNextClick.current = false;
        e.stopPropagation();
        e.preventDefault();
    }, []);

    const handlers: DragToCommitHandlers = {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        onClickCapture,
    };

    return { state, handlers };
}
