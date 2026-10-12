// PROTOTYPE (issue #4433) — throwaway coin, sized per variant.
import { motion } from "motion/react";
import { faceLabel, isGood, type ProtoFlip } from "./prototype-scenarios";

export default function ProtoCoin({
    flip,
    state,
    spinMs,
    size,
    reduceMotion,
}: {
    flip: ProtoFlip;
    state: "pending" | "spinning" | "landed";
    spinMs: number;
    size: number;
    reduceMotion: boolean;
}) {
    const good = isGood(flip);
    const fontSize = Math.max(9, Math.round(size / 6.5));
    if (state === "pending") {
        return (
            <div
                className="rounded-full border-2 border-dashed border-border/60"
                style={{ width: size, height: size }}
            />
        );
    }
    const spinning = state === "spinning";
    const tone = spinning
        ? "border-border-accent/60 bg-surface-elevated/80 text-text-muted"
        : good
          ? "border-accent/70 bg-accent-soft/40 text-accent-strong"
          : "border-danger/60 bg-danger/15 text-danger";
    return (
        <div style={{ width: size, height: size, perspective: 600 }}>
            <motion.div
                key={state}
                className={`flex h-full w-full items-center justify-center rounded-full border-2 text-display tracking-wide ${tone}`}
                style={{ fontSize }}
                initial={
                    spinning && !reduceMotion
                        ? { rotateY: 0, scale: 0.9 }
                        : false
                }
                animate={
                    spinning && !reduceMotion
                        ? {
                              rotateY: (good ? 4 : 4.5) * 360,
                              scale: [0.9, 1.15, 1],
                          }
                        : undefined
                }
                transition={{ duration: spinMs / 1000, ease: "easeOut" }}
            >
                {spinning ? (reduceMotion ? "…" : "") : faceLabel(flip)}
            </motion.div>
        </div>
    );
}
