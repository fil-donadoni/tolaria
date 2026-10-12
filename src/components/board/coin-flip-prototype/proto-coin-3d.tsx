// PROTOTYPE (issue #4433) — throwaway 3D coin: tossed in an arc, tumbling on
// the X axis, landing on the drawn face with a small bounce; the outcome shows
// as a halo + caption UNDER the coin (the coin itself only shows heads/tails).
import { motion } from "motion/react";
import "./proto-coin-3d.css";
import { MoonGlyph, SunGlyph } from "./proto-coin-glyphs";

const EDGE_LAYERS = 12;

export default function ProtoCoin3D({
    face,
    phase,
    durationMs,
    size,
    tone,
    reduceMotion,
}: {
    face: "heads" | "tails";
    /** "idle" = resting on heads before the toss. */
    phase: "idle" | "tossing" | "landed";
    durationMs: number;
    size: number;
    tone: "good" | "bad";
    reduceMotion: boolean;
}) {
    const thickness = Math.max(6, Math.round(size * 0.09));
    const finalX = (face === "heads" ? 4 : 4.5) * 360;
    const restX = phase === "idle" ? 0 : face === "heads" ? 0 : 180;
    const lift = size * 1.1;
    const tossing = phase === "tossing" && !reduceMotion;
    const t = { duration: durationMs / 1000, times: [0, 0.48, 0.86, 0.93, 1] };

    return (
        <div
            className="pc3d"
            style={{ ["--pc3d-size" as string]: `${size}px` }}
        >
            <motion.div
                className="pc3d-shadow"
                animate={
                    tossing
                        ? {
                              scaleX: [1, 0.45, 1, 0.9, 1],
                              opacity: [0.9, 0.35, 0.9, 0.8, 0.9],
                          }
                        : { scaleX: 1, opacity: 0.9 }
                }
                transition={tossing ? t : { duration: 0 }}
            />
            <motion.div
                className="pc3d-body"
                key={`${phase}-${face}`}
                initial={
                    tossing
                        ? { y: 0, rotateX: 0, scale: 1 }
                        : reduceMotion && phase === "landed"
                          ? { opacity: 0 }
                          : false
                }
                animate={
                    tossing
                        ? {
                              y: [0, -lift, 0, -size * 0.08, 0],
                              rotateX: [
                                  0,
                                  finalX * 0.55,
                                  finalX,
                                  finalX,
                                  finalX,
                              ],
                              scale: [1, 1.18, 1, 1.02, 1],
                          }
                        : { y: 0, rotateX: restX, scale: 1, opacity: 1 }
                }
                transition={
                    tossing
                        ? {
                              ...t,
                              ease: ["easeOut", "easeIn", "easeOut", "easeIn"],
                          }
                        : { duration: reduceMotion ? 0.25 : 0 }
                }
            >
                {Array.from({ length: EDGE_LAYERS }).map((_, i) => {
                    const z =
                        -thickness / 2 + (thickness * i) / (EDGE_LAYERS - 1);
                    return (
                        <div
                            key={i}
                            className="pc3d-edge"
                            style={{ transform: `translateZ(${z}px)` }}
                        />
                    );
                })}
                <div
                    className="pc3d-face"
                    style={{
                        transform: `translateZ(${thickness / 2 + 0.5}px)`,
                    }}
                >
                    <SunGlyph className="pc3d-glyph" />
                    <span className="pc3d-word">HEADS</span>
                </div>
                <div
                    className="pc3d-face"
                    style={{
                        transform: `rotateX(180deg) translateZ(${thickness / 2 + 0.5}px)`,
                    }}
                >
                    <MoonGlyph className="pc3d-glyph" />
                    <span className="pc3d-word">TAILS</span>
                </div>
            </motion.div>
            {phase === "landed" && (
                <motion.div
                    className="pc3d-halo"
                    data-tone={tone}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: reduceMotion ? 0 : 0.25 }}
                />
            )}
        </div>
    );
}
