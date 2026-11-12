import type { TargetArrow } from "~/lib/target-arrow-geometry";
import {
    ARROW_ACCENT,
    ARROW_STRONG,
    type ArrowDefIds,
    type ArrowStrength,
} from "~/lib/board-arrow-style";

/** Resting opacity of a quiet arrow. */
const QUIET_OPACITY = 0.4;

/** One metallic-gold arrow (`<g>` of aura + gradient core + hairline). */
export default function BoardArrowPath({
    arrow,
    strength,
    dimmed,
    dimOpacity,
    ids,
}: {
    arrow: TargetArrow;
    strength: ArrowStrength;
    /** Outside the hovered relationship. */
    dimmed: boolean;
    dimOpacity: number;
    ids: ArrowDefIds;
}) {
    const emphasized = strength === "emphasized";
    const quiet = strength === "quiet";
    return (
        <g
            opacity={dimmed ? dimOpacity : quiet ? QUIET_OPACITY : 1}
            style={{ transition: "opacity 140ms ease" }}
            filter={quiet ? undefined : `url(#${ids.shadow})`}
        >
            {/* Soft gold aura (no dark channel, no heavy glow) — dropped at
                rest for a quiet arrow, which is a thread, not a wire. */}
            {!quiet && (
                <path
                    d={arrow.path}
                    fill="none"
                    stroke={ARROW_ACCENT}
                    strokeWidth={emphasized ? 9 : 6}
                    strokeLinecap="round"
                    opacity={emphasized ? 0.32 : 0.18}
                />
            )}
            {/* Gradient core + arrowhead — the body of the wire. */}
            <path
                data-arrow-key={arrow.key}
                data-arrow-kind={arrow.kind}
                data-arrow-strength={dimmed ? "dimmed" : strength}
                d={arrow.path}
                fill="none"
                stroke={`url(#${ids.grad})`}
                strokeWidth={emphasized ? 3.4 : quiet ? 1.2 : 2.4}
                strokeLinecap="round"
                markerEnd={`url(#${ids.head})`}
            />
            {/* Bright hairline highlight along the top — gives the filament
                its metallic catch-light. */}
            {!quiet && (
                <path
                    d={arrow.path}
                    fill="none"
                    stroke={ARROW_STRONG}
                    strokeWidth={emphasized ? 1.1 : 0.8}
                    strokeLinecap="round"
                    opacity={0.9}
                />
            )}
        </g>
    );
}
