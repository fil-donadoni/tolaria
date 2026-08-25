import { useReducedMotion } from "motion/react";

/**
 * One-shot gold emphasis played on a card that just changed zone (validated
 * as "variant B's glow, without the bounce" in the zone-motion prototype).
 * A pure overlay: it never intercepts pointer events and fades itself out via
 * the `arrivalGlow` CSS keyframe. Re-mounts (and so replays) whenever `show`
 * flips back to true. Reduced-motion users get no glow — the flight itself is
 * already disabled for them, and a flashing ring without the motion that
 * motivates it is pure noise.
 */
export default function ArrivalGlow({ show }: { show: boolean }) {
    const reduceMotion = useReducedMotion();
    if (!show || reduceMotion) return null;
    return (
        <div
            aria-hidden
            data-arrival-glow
            className="arrival-glow pointer-events-none absolute -inset-1 z-20 card-corner"
        />
    );
}
