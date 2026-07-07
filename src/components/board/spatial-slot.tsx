import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Placement } from "~/lib/board-layout";
import { SLOT_SPRING } from "~/lib/board-motion";

type SpatialSlotProps = {
    /** Stable identity for this slot — the card instance id (or a stable
     *  `hidden-*` handle for opponent backs). Drives both the React key and the
     *  cross-zone `layoutId` so the SAME logical element animates when a card
     *  changes zone (#252). */
    slotId: string;
    /** Resolved target placement (already mirrored if needed). */
    placement: Placement;
    /** Base card footprint in px. */
    cardWidth: number;
    cardHeight: number;
    /** Disable this slot's reflow spring so it lands on its placement instantly
     *  (no tween), AND raise it above every sibling slot. Used for the card being
     *  dragged: its own lift cancels the reordered placement, so any slot tween
     *  would show as the card drifting away from the pointer, and its DOM node
     *  stays in place (deferred-commit reorder) so a plain inner z-index can't
     *  lift it over later siblings — the whole slot must be raised. Neighbours
     *  keep springing at their resting stack level. */
    snap?: boolean;
    children: ReactNode;
};

/**
 * One animated card slot for the spatial board (PRD #249, slice #252).
 *
 * Two layers, deliberately separated so the placement math stays the single,
 * test-readable source of truth (#251) while the motion is purely visual:
 *
 * - **Outer** (`[data-card-slot]`): carries the *exact* target placement as a
 *   literal `transform` string. Layout tests and target-arrow anchoring read
 *   this, so they always see the resolved position immediately — never a mid-
 *   tween value. A CSS `transition` on `transform` springs the outer element to
 *   its new placement when the card's slot reflows within a zone (add / remove /
 *   reorder) instead of jumping (AC: re-flow doesn't jump).
 * - **Inner** (`motion.div` with `layoutId={slotId}`): a shared-layout element.
 *   When a card changes zone it unmounts from one `SpatialZone` subtree and
 *   mounts in another; motion matches the two by `layoutId` and runs a FLIP so
 *   the SAME perceived element animates across the zone boundary rather than
 *   teleporting (AC: identity preserved across zone change, animates not
 *   destroyed/recreated).
 *
 * Accessibility: when the user prefers reduced motion, both the CSS transition
 * and the motion layout animation are disabled — cards snap to placement. Text
 * crispness is preserved because neither layer applies a non-integer blur or a
 * persistent sub-pixel scale: the transform targets the same crisp placement the
 * static board would use.
 */
export default function SpatialSlot({
    slotId,
    placement,
    cardWidth,
    cardHeight,
    snap = false,
    children,
}: SpatialSlotProps) {
    const reduceMotion = useReducedMotion();

    const transform =
        `translate(${placement.x - cardWidth / 2}px, ` +
        `${placement.y - cardHeight / 2}px) ` +
        `rotate(${placement.rotation}deg) scale(${placement.scale})`;

    // A freshly inserted element paints at its initial computed transform with
    // no transition origin, so a permanent `transition: transform` never causes
    // a slide-in from the page origin on mount — it only springs when the
    // transform *changes* (reflow within a zone, or a card landing at a new
    // placement). Disabled entirely for reduced-motion users (accessibility) and
    // for the dragged slot (`snap`): cards snap to placement.
    const animate = !reduceMotion && !snap;

    return (
        <div
            data-card-slot={slotId}
            className="absolute left-0 top-0 will-change-transform"
            style={{
                width: cardWidth,
                height: cardHeight,
                transform,
                transition: animate
                    ? `transform ${SLOT_SPRING.cssDuration} ${SLOT_SPRING.cssEasing}`
                    : "none",
                // The dragged slot rides above every sibling for the whole
                // gesture (it never reorders in the DOM, so it needs an explicit
                // lift over later-painted slots).
                zIndex: snap ? 50 : undefined,
            }}
        >
            <motion.div
                layout
                layoutId={slotId}
                transition={
                    reduceMotion || snap ? { duration: 0 } : SLOT_SPRING.motion
                }
                className="w-full h-full"
            >
                {children}
            </motion.div>
        </div>
    );
}
