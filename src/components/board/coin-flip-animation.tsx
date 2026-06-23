import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";

/** Total coin-spin duration before the chooser auto-acknowledges (ADR 0023 —
 *  animation timing is a CLIENT concern; the engine carries no wall-clock).
 *  Reduced motion shows the landed face statically for the same duration so the
 *  reveal flow and timing are identical. */
export const FLIP_ANIM_MS = 1600;

/** Animated coin (CR 705.2 / ADR 0023). Spins through two landings and settles
 *  on the face parametrized by `result` (1 = heads/WIN, 0 = tails/LOSE), then
 *  fires `onLanded` once the animation completes. Under `prefers-reduced-motion`
 *  the landed face is shown statically for `FLIP_ANIM_MS`, then `onLanded`
 *  fires — same timing, no spin. Pure presentation; the outcome is already
 *  decided server-side and only revealed here. */
export default function CoinFlipAnimation({
    result,
    face,
    onLanded,
}: {
    /** 0-based index the coin landed on: 1 = heads, 0 = tails. */
    result: number;
    /** Label rendered on the landed face (WIN / LOSE or an override). */
    face: string;
    /** Fired exactly once when the animation (or reduced-motion hold) ends. */
    onLanded: () => void;
}) {
    const reduceMotion = useReducedMotion();
    const isHeads = result === 1;

    // Reduced motion: hold the static landed face for the same duration, then
    // signal completion. No spin, identical flow (ADR 0023).
    useEffect(() => {
        if (!reduceMotion) return;
        const t = setTimeout(onLanded, FLIP_ANIM_MS);
        return () => clearTimeout(t);
    }, [reduceMotion, onLanded]);

    // Two landings: spin past the off-face once, then settle on the result.
    // Final rotation parametrized by result so the landed face matches the
    // outcome (heads = even half-turns, tails = odd half-turns).
    const finalTurns = isHeads ? 4 : 4.5;

    return (
        <div className="flex flex-col items-center gap-3">
            <motion.div
                className="relative flex items-center justify-center"
                style={{ width: 96, height: 96, perspective: 600 }}
            >
                <motion.div
                    className={`flex h-24 w-24 items-center justify-center rounded-full border-2 font-beleren text-lg tracking-wide ${
                        isHeads
                            ? "border-accent/70 bg-accent-soft/40 text-accent-strong"
                            : "border-border-accent/60 bg-surface-elevated/60 text-text-muted"
                    }`}
                    initial={reduceMotion ? false : { rotateY: 0, scale: 0.9 }}
                    animate={
                        reduceMotion
                            ? undefined
                            : {
                                  rotateY: finalTurns * 360,
                                  scale: [0.9, 1.15, 1],
                              }
                    }
                    transition={
                        reduceMotion
                            ? undefined
                            : {
                                  duration: FLIP_ANIM_MS / 1000,
                                  ease: "easeOut",
                              }
                    }
                    onAnimationComplete={reduceMotion ? undefined : onLanded}
                >
                    {face}
                </motion.div>
            </motion.div>
        </div>
    );
}
