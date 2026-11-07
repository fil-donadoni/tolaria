import { motion } from "motion/react";
import "./coin-3d.css";
import CoinMoonGlyph from "./coin-moon-glyph";
import CoinSunGlyph from "./coin-sun-glyph";

const EDGE_LAYERS = 12;

export type Coin3DPhase = "tossing" | "landed";

/** Design-system 3D coin: tossed in an arc, tumbling on the X axis and
 *  landing with a small bounce, a ground shadow scaling with height. The
 *  faces show only HEADS (sun) / TAILS (moon); the outcome is the halo
 *  (`tone`), never part of the coin (CR 705.2). Under reduced motion there is
 *  no toss or spin — the landed face fades in. */
export default function Coin3D({
    face,
    phase,
    durationMs,
    size = 112,
    tone,
    reduceMotion,
}: {
    face: "heads" | "tails";
    phase: Coin3DPhase;
    durationMs: number;
    size?: number;
    tone: "good" | "bad";
    reduceMotion: boolean;
}) {
    const thickness = Math.max(6, Math.round(size * 0.09));
    const finalX = (face === "heads" ? 4 : 4.5) * 360;
    const restX = face === "heads" ? 0 : 180;
    const lift = size * 1.1;
    const tossing = phase === "tossing" && !reduceMotion;
    const t = { duration: durationMs / 1000, times: [0, 0.48, 0.86, 0.93, 1] };

    return (
        <div
            className="coin3d"
            data-testid="coin-3d"
            data-face={face}
            data-phase={phase}
            style={{ ["--coin3d-size" as string]: `${size}px` }}
        >
            <motion.div
                className="coin3d-shadow"
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
                className="coin3d-body"
                key={`${phase}-${face}`}
                initial={
                    tossing
                        ? { y: 0, rotateX: 0, scale: 1 }
                        : reduceMotion
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
                            className="coin3d-edge"
                            style={{ transform: `translateZ(${z}px)` }}
                        />
                    );
                })}
                <div
                    className="coin3d-face"
                    style={{
                        transform: `translateZ(${thickness / 2 + 0.5}px)`,
                    }}
                >
                    <CoinSunGlyph className="coin3d-glyph" />
                    <span className="coin3d-word">HEADS</span>
                </div>
                <div
                    className="coin3d-face"
                    style={{
                        transform: `rotateX(180deg) translateZ(${thickness / 2 + 0.5}px)`,
                    }}
                >
                    <CoinMoonGlyph className="coin3d-glyph" />
                    <span className="coin3d-word">TAILS</span>
                </div>
            </motion.div>
            {phase === "landed" && (
                <motion.div
                    className="coin3d-halo"
                    data-testid="coin-halo"
                    data-tone={tone}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: reduceMotion ? 0 : 0.25 }}
                />
            )}
        </div>
    );
}
