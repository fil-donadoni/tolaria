import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useLifeDelta } from "~/hooks/useLifeDelta";

const GAIN = "var(--color-success-strong)";
const LOSS = "var(--color-danger-strong)";
const REST = "var(--color-accent-strong)";

type Pop = { id: number; delta: number };

/**
 * The player life total with its change effect (slice — life-change feedback).
 * On a change it does two things at once: the number itself flashes
 * red (loss) / green (gain) and scale-pulses back to the gold accent, and a
 * signed "+N" / "−N" floats up over it and fades. Rapid changes stack their
 * floaters. Respects `prefers-reduced-motion` (no pulse/float, just the
 * settled number). Drop-in replacement for the static life `<div>` inside
 * {@link PlayerNameplate}.
 */
export default function AnimatedLifeTotal({
    life,
    compact = false,
}: {
    life: number;
    /** Portrait compact nameplate (#1814 round-2 fixup): a smaller,
     *  `leading-none` line-height EXACTLY `1.125rem` (18px) — see
     *  `PORTRAIT_NAMEPLATE_ROW_PX` in `portrait-board-bands.ts`, whose value
     *  this class must stay in lockstep with (that constant documents the
     *  full box-height derivation the reserved band is sized from). */
    compact?: boolean;
}) {
    const { delta, tick } = useLifeDelta(life);
    const reduce = useReducedMotion();
    const color = delta === 0 ? REST : delta > 0 ? GAIN : LOSS;

    const [pops, setPops] = useState<Pop[]>([]);
    const nextId = useRef(0);

    useEffect(() => {
        if (tick === 0 || delta === 0) return;
        const id = nextId.current++;
        setPops((p) => [...p, { id, delta }]);
        const t = setTimeout(
            () => setPops((p) => p.filter((x) => x.id !== id)),
            reduce ? 400 : 900
        );
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tick]);

    return (
        <div className="relative">
            <motion.div
                key={tick}
                className={`${compact ? "text-lg" : "text-3xl"} font-bold leading-none tabular-nums`}
                initial={reduce ? false : { color, scale: 1 }}
                animate={
                    reduce
                        ? { color: REST }
                        : { color: [color, color, REST], scale: [1, 1.22, 1] }
                }
                transition={
                    reduce
                        ? undefined
                        : {
                              duration: 0.42,
                              times: [0, 0.4, 1],
                              ease: "easeOut",
                          }
                }
            >
                {life}
            </motion.div>
            <AnimatePresence>
                {pops.map((pop) => (
                    <motion.div
                        key={pop.id}
                        className="absolute left-1/2 top-0 -translate-x-1/2 text-xl font-bold tabular-nums pointer-events-none"
                        style={{ color: pop.delta > 0 ? GAIN : LOSS }}
                        initial={{ y: 0, opacity: 0, scale: 0.8 }}
                        animate={
                            reduce
                                ? { y: -10, opacity: 1, scale: 1 }
                                : { y: -30, opacity: [0, 1, 1, 0], scale: 1 }
                        }
                        exit={{ opacity: 0 }}
                        transition={{
                            duration: reduce ? 0.2 : 0.85,
                            ease: "easeOut",
                        }}
                    >
                        {pop.delta > 0 ? `+${pop.delta}` : pop.delta}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
