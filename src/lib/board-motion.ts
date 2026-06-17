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
