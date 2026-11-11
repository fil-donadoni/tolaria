// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=`).
// The live arrow: the real board's curve (`arrowPath`) and gold filament,
// heavier, with a "locked" weight for when it has snapped onto a legal target.
import { arrowPath, type AnchorPoint } from "~/lib/target-arrow-geometry";

export default function PrototypeTargetFilament({
    from,
    to,
    locked = false,
    seeking = false,
}: {
    from: AnchorPoint;
    to: AnchorPoint;
    /** Snapped onto a legal target. */
    locked?: boolean;
    /** Still following the cursor: marching dashes instead of a solid wire. */
    seeking?: boolean;
}) {
    const d = arrowPath(from, to);
    return (
        <g style={{ filter: "drop-shadow(0 2px 3px rgba(0,0,0,.55))" }}>
            <path
                d={d}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={locked ? 16 : 9}
                strokeLinecap="round"
                opacity={locked ? 0.4 : 0.2}
            />
            <path
                d={d}
                fill="none"
                stroke="url(#prototype-target-grad)"
                strokeWidth={locked ? 6 : 3.5}
                strokeLinecap="round"
                strokeDasharray={seeking && !locked ? "14 14" : undefined}
                style={
                    seeking && !locked
                        ? {
                              animation:
                                  "prototypeTargetDash 600ms linear infinite",
                          }
                        : undefined
                }
                markerEnd="url(#prototype-target-head)"
            />
        </g>
    );
}
