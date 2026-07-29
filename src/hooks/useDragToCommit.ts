import { useCallback, useRef, useState } from "react";

/** Upward travel (px) past which a release commits. Lifting the card above this
 *  "line over the hand" and releasing fires the commit; releasing below it is a
 *  no-op return-to-hand. Lowered again (issue #294, fix 3) so the upward gesture
 *  reads purely as "play this card" — a short, deliberate flick commits — while
 *  still clearing the {@link DRAG_START_PX} drag-start deadzone so an accidental
 *  nudge never commits. */
export const COMMIT_LIFT_PX = 26;
/** Total travel (px) before a press is treated as a drag rather than a click.
 *  Below this, pointerup is a plain click and the gesture stays inert. */
const DRAG_START_PX = 6;
/** Upward travel (px) the card is allowed to visually rise past the commit
 *  line. The card stays armed for any lift ≥ {@link COMMIT_LIFT_PX}, but the
 *  rendered lift is clamped here so a dragged card never escapes up into the
 *  `overflow-hidden` band above the hand where it would be clipped / lost
 *  (issue #271, fix 4). It stays visible for the whole gesture. */
const MAX_LIFT_PX = COMMIT_LIFT_PX + 18;

export type DragToCommitState = {
    /** True once the pointer has travelled past {@link DRAG_START_PX} — the card
     *  is being dragged (used to lift it visually and suppress hover tilt). */
    dragging: boolean;
    /** Live pointer offset from the press origin, in px. The hand card never
     *  free-floats: the horizontal component tracks the pointer (it drives the
     *  reorder snap), but the vertical component is UP-ONLY and only for a
     *  castable/playable card — downward travel is pinned to 0 so a card can't be
     *  dragged below its slot, and the upward lift exists solely as the
     *  cast/play gesture (clamped to {@link MAX_LIFT_PX} so it never escapes into
     *  the clipped band above the hand). A non-committable card gets no lift at
     *  all (`y` stays 0). `{0,0}` when idle. (issues #271 fix 4, #294 fixes 2-3) */
    offset: { x: number; y: number };
    /** Live pointer x in viewport (client) px, for drag-reorder snap (#271,
     *  fix 2). `null` when idle. */
    pointerX: number | null;
    /** True while dragging AND lifted past the commit threshold — the release
     *  will commit. Drives the "armed" affordance. */
    armed: boolean;
};

export type DragToCommitHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => void;
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
        pointerX: null,
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
        setState({
            dragging: false,
            offset: { x: 0, y: 0 },
            pointerX: null,
            armed: false,
        });
    }, []);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
        // Only the primary button initiates a drag; right/middle clicks fall
        // through to context menus etc.
        if (e.button !== 0) return;
        // Clear any stale swallow from a previous gesture that never received
        // its trailing click (e.g. released off-card) — otherwise the NEXT real
        // click on this card would be eaten (drag-persistence bug, #294 fix 2).
        swallowNextClick.current = false;
        press.current = {
            startX: e.clientX,
            startY: e.clientY,
            active: false,
            pointerId: e.pointerId,
        };
    }, []);

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLElement>) => {
            const p = press.current;
            if (!p) return;
            const dx = e.clientX - p.startX;
            const dy = e.clientY - p.startY;
            if (!p.active) {
                if (Math.hypot(dx, dy) < DRAG_START_PX) return;
                p.active = true;
                e.currentTarget.setPointerCapture(e.pointerId);
            }
            // Upward lift is negative dy; arm from the RAW lift so the commit
            // threshold is unaffected by the visual clamp below. Only a
            // committable card can arm — for an unplayable card the upward drag
            // is meaningless and must not pretend it can be cast (#294 fix 3).
            const armed = commitEnabled && -dy >= COMMIT_LIFT_PX;
            // The card never free-floats (#294 fix 2): horizontal tracks the
            // pointer (drives the reorder snap); vertical is UP-ONLY and only for
            // a committable card — downward is pinned to 0 and the upward lift is
            // clamped so it never escapes the clipped band above (#271 fix 4).
            const upOnly = dy < 0 ? dy : 0;
            const clampedUp = upOnly < -MAX_LIFT_PX ? -MAX_LIFT_PX : upOnly;
            const liftY = commitEnabled ? clampedUp : 0;
            setState({
                dragging: true,
                offset: { x: dx, y: liftY },
                pointerX: e.clientX,
                armed,
            });
        },
        [commitEnabled]
    );

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

    // If the element loses pointer capture mid-drag — e.g. the hand reorders and
    // the captured slot is moved/re-keyed under it — pointerup may never reach
    // this card and the lift would stick forever. Resetting on capture loss keeps
    // the gesture from getting wedged in the dragging state (#294 fix 2). It is a
    // no-op when capture is released normally by `onPointerUp` (already reset).
    //
    // Touch-only trap (same shape as `LibraryOrderPicker` / `TriggerOrderPrompt`,
    // issue #1772 — issue #1820 is this same bug class in the hand-card drag):
    // a touch `pointerdown` grants the deepest hit-tested DESCENDANT (the
    // card's tilt/preview/image subtree under this root) IMPLICIT pointer
    // capture. The first `setPointerCapture` call above, in `onPointerMove` —
    // on `e.currentTarget` (THIS root) — transfers capture away from that
    // descendant, which fires `lostpointercapture` ON THE DESCENDANT. It
    // bubbles here even though capture just moved TO this element, not away
    // from it, and the unguarded handler used to read every bubbled
    // `lostpointercapture` as "capture lost mid-drag" and `reset()` — on
    // touch, that fired on the very first qualifying move (the same move that
    // just called `setPointerCapture`), wiping the drag before it could ever
    // reach the commit threshold: an upward swipe never committed. Only a
    // `lostpointercapture` whose target IS this root (this element itself
    // losing its OWN capture, e.g. the hand's drag-reorder re-keying the slot
    // mid-drag, #294 fix 2) should reset.
    const onLostPointerCapture = useCallback(
        (e: React.PointerEvent<HTMLElement>) => {
            if (e.target !== e.currentTarget) return;
            if (press.current) reset();
        },
        [reset]
    );

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
        onLostPointerCapture,
        onClickCapture,
    };

    return { state, handlers };
}
