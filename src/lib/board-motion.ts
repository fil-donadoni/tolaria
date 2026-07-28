/**
 * Shared zone-transition animation constants for the spatial board
 * (PRD #249, slice #252). Cards animate to their target {@link Placement} with
 * a spring when their placement changes — a zone change (hand → battlefield),
 * a count change, or a reorder — instead of jumping.
 *
 * One spring definition, two consumers, kept in sync here so the in-zone CSS
 * transition (outer slot) and the cross-zone `motion` FLIP (inner shared-layout
 * element) feel like the same motion:
 *
 * - `motion` — passed to `motion`'s `transition` prop for the cross-zone FLIP.
 * - `cssDuration` / `cssEasing` — an eased CSS `transition` approximating the
 *   same spring for the outer slot's in-zone reflow (no per-frame React state).
 *
 * The values are a moderately snappy spring: quick enough to track a fast play
 * sequence, soft enough to read as physical motion rather than a hard cut.
 */
export const SLOT_SPRING = {
    /** `motion` spring config for the cross-zone shared-layout FLIP. */
    motion: {
        type: "spring",
        stiffness: 520,
        damping: 38,
        mass: 1,
    },
    /** CSS transition duration approximating the spring's settle time. */
    cssDuration: "0.34s",
    /** CSS easing approximating a critically-damped spring's overshoot-free
     *  settle (ease-out with a touch of late deceleration). */
    cssEasing: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

/**
 * Stack level a hand card is raised to while it is LIFTED out of the hand —
 * dragged toward the commit line (#254), or staged by a touch tap (#1767).
 *
 * A lifted card MUST paint above its neighbours, because both hand layouts
 * overlap their cards: the portrait row overlaps by 26px of a 76px card (~34%
 * of every card is covered by the next one) and the spatial fan overlaps
 * likewise. Without the raise, the "second tap on the card" that confirms a
 * staged play lands on the NEIGHBOUR — cancelling the stage and staging the
 * neighbour instead — on exactly the layout the touch flow targets.
 */
export const LIFTED_CARD_Z = 50;

/**
 * Arena-style hover tilt constants for the spatial board (PRD #249, slice #253).
 *
 * The validated core (from the throwaway prototype `card-tilt.tsx`): on
 * `pointermove` the card tilts toward the cursor — `px`/`py` are the pointer's
 * offset from the card center in -0.5..0.5, mapped to `rotateX`/`rotateY` of up
 * to {@link CARD_TILT.maxTiltDeg}, with a small `translateZ` lift and a subtle
 * scale, plus a radial glare that tracks the pointer. On leave the transform
 * eases back to flat over a longer duration and the glare fades out.
 *
 * The tilt is written imperatively to the element style on every pointermove —
 * NO per-frame React state — so it stays smooth and text stays crisp (DOM
 * rendering, no blur). It is applied on an INNER element so it composes with the
 * outer slot's placement transform and the `motion` FLIP layer (#252) instead of
 * fighting them.
 */
export const CARD_TILT = {
    /** Max tilt magnitude in degrees — a small Arena-like twist (tunable). */
    maxTiltDeg: 14,
    /** Forward lift toward the viewer on hover, in px (the `translateZ`). */
    liftZ: 28,
    /** Uniform scale-up on hover (the subtle "this card is live" pop). */
    hoverScale: 1.07,
    /** Perspective depth applied to the tilt container, in px. Smaller = more
     *  dramatic foreshortening. */
    perspectivePx: 700,
    /** Snappy follow while the pointer moves over the card. */
    moveTransition: "transform 60ms linear",
    /** Longer eased settle back to flat on pointer leave. */
    resetTransition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1)",
    /** Glare opacity at full hover (faded to 0 on leave). */
    glareOpacity: 0.55,
} as const;
