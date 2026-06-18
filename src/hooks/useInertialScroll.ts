import { useCallback, useEffect, useRef } from "react";

/**
 * Arena-like inertial scrolling for an overflow container (PRD #249, slice
 * #255). Attach the returned ref to any scrollable element (e.g. a card pile's
 * overflow strip or an overflowing zone) and pointer-dragging it pans with
 * momentum: releasing a fast drag keeps gliding and eases to a stop, the way
 * MTG Arena's piles feel.
 *
 * Accessibility is preserved by construction — this hook ADDS a pointer
 * affordance, it never replaces the native ones:
 *
 * - Native wheel/trackpad scroll, the scrollbar, and keyboard scrolling
 *   (`ArrowLeft`/`ArrowRight`, `Home`/`End`, `Tab`-to-focus then arrows) all
 *   keep working — we never call `preventDefault` on wheel or key events and
 *   never set `overflow: hidden`.
 * - A real drag (pointer moved past {@link DRAG_THRESHOLD_PX}) suppresses the
 *   click that would otherwise fire on release, so dragging the strip doesn't
 *   accidentally activate a card. A plain click (no drag) passes through, and
 *   focus/`:focus-visible` outlines are untouched.
 * - Starting a drag on a focusable child (button/link/input) is ignored so the
 *   element stays keyboard-operable; momentum only starts from the strip
 *   background.
 *
 * No per-frame React state: the momentum loop writes `scrollLeft`/`scrollTop`
 * directly, so scrolling stays smooth and never churns renders.
 */

/** Pixels of pointer travel before a press is treated as a drag (not a click). */
const DRAG_THRESHOLD_PX = 6;
/** Per-frame velocity decay (closer to 1 = longer glide). */
const FRICTION = 0.92;
/** Below this px/frame the momentum loop stops. */
const MIN_VELOCITY = 0.4;

type Axis = "x" | "y" | "both";

/** True when the press began on a natively-interactive CHILD of the scroll
 *  container, which must keep its own pointer/keyboard behaviour rather than
 *  being hijacked for panning. The container itself is excluded: it is made
 *  focusable (`tabindex`) for native keyboard scrolling, so a press on its
 *  background must still start a pan. */
function isInteractiveTarget(
    target: EventTarget | null,
    container: HTMLElement
): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const hit = target.closest(
        'button, a, input, select, textarea, [role="button"], [tabindex]'
    );
    return !!hit && hit !== container && container.contains(hit);
}

export function useInertialScroll<T extends HTMLElement>(axis: Axis = "x") {
    const ref = useRef<T>(null);
    // All gesture state is in a ref so the momentum loop and handlers share it
    // without re-rendering.
    const state = useRef({
        pointerId: -1,
        startX: 0,
        startY: 0,
        lastX: 0,
        lastY: 0,
        velX: 0,
        velY: 0,
        dragging: false,
        moved: false,
        raf: 0,
    });

    const stopMomentum = useCallback(() => {
        if (state.current.raf) {
            cancelAnimationFrame(state.current.raf);
            state.current.raf = 0;
        }
    }, []);

    const startMomentum = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const step = () => {
            const s = state.current;
            const horiz = axis === "x" || axis === "both";
            const vert = axis === "y" || axis === "both";
            if (horiz) {
                el.scrollLeft -= s.velX;
                s.velX *= FRICTION;
            }
            if (vert) {
                el.scrollTop -= s.velY;
                s.velY *= FRICTION;
            }
            const speed = Math.max(Math.abs(s.velX), Math.abs(s.velY));
            if (speed > MIN_VELOCITY) {
                s.raf = requestAnimationFrame(step);
            } else {
                s.raf = 0;
            }
        };
        stopMomentum();
        state.current.raf = requestAnimationFrame(step);
    }, [axis, stopMomentum]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const onPointerDown = (e: PointerEvent) => {
            // Only primary-button / touch / pen drags pan; ignore presses that
            // begin on interactive children so they stay keyboard-operable.
            if (e.button !== 0) return;
            if (isInteractiveTarget(e.target, el)) return;
            stopMomentum();
            const s = state.current;
            s.pointerId = e.pointerId;
            s.startX = s.lastX = e.clientX;
            s.startY = s.lastY = e.clientY;
            s.velX = 0;
            s.velY = 0;
            s.dragging = true;
            s.moved = false;
        };

        const onPointerMove = (e: PointerEvent) => {
            const s = state.current;
            if (!s.dragging || e.pointerId !== s.pointerId) return;
            const dx = e.clientX - s.lastX;
            const dy = e.clientY - s.lastY;
            if (
                !s.moved &&
                Math.hypot(e.clientX - s.startX, e.clientY - s.startY) >
                    DRAG_THRESHOLD_PX
            ) {
                s.moved = true;
                // Capture so the drag survives the pointer leaving the strip.
                // Guarded: a missing/synthetic pointer must not abort the pan.
                try {
                    el.setPointerCapture(s.pointerId);
                } catch {
                    /* no active pointer (e.g. tests) — panning still works */
                }
            }
            if (!s.moved) return;
            if (axis === "x" || axis === "both") el.scrollLeft -= dx;
            if (axis === "y" || axis === "both") el.scrollTop -= dy;
            s.velX = dx;
            s.velY = dy;
            s.lastX = e.clientX;
            s.lastY = e.clientY;
        };

        const endDrag = (e: PointerEvent) => {
            const s = state.current;
            if (e.pointerId !== s.pointerId) return;
            s.dragging = false;
            s.pointerId = -1;
            if (el.hasPointerCapture(e.pointerId))
                el.releasePointerCapture(e.pointerId);
            // Fling: only if the release carried real velocity.
            if (s.moved) startMomentum();
        };

        // A real drag must not turn into a click on the card under the pointer.
        const onClickCapture = (e: MouseEvent) => {
            if (state.current.moved) {
                e.preventDefault();
                e.stopPropagation();
                state.current.moved = false;
            }
        };

        el.addEventListener("pointerdown", onPointerDown);
        el.addEventListener("pointermove", onPointerMove);
        el.addEventListener("pointerup", endDrag);
        el.addEventListener("pointercancel", endDrag);
        el.addEventListener("click", onClickCapture, true);
        return () => {
            stopMomentum();
            el.removeEventListener("pointerdown", onPointerDown);
            el.removeEventListener("pointermove", onPointerMove);
            el.removeEventListener("pointerup", endDrag);
            el.removeEventListener("pointercancel", endDrag);
            el.removeEventListener("click", onClickCapture, true);
        };
    }, [axis, startMomentum, stopMomentum]);

    return ref;
}
