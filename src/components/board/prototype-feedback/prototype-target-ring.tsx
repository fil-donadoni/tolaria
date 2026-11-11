// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-target-arrow=`).
import type { PrototypeTargetBox } from "./prototype-target-geometry";

export default function PrototypeTargetRing({
    box,
    color,
    width = 3,
    pad = 4,
    pulse = false,
    glow = true,
}: {
    box: PrototypeTargetBox;
    color: string;
    width?: number;
    pad?: number;
    pulse?: boolean;
    glow?: boolean;
}) {
    return (
        <rect
            x={box.x - pad}
            y={box.y - pad}
            width={box.w + pad * 2}
            height={box.h + pad * 2}
            rx={8}
            fill="none"
            stroke={color}
            strokeWidth={width}
            style={{
                filter: glow ? `drop-shadow(0 0 8px ${color})` : undefined,
                animation: pulse
                    ? "prototypeTargetPulse 1.1s ease-in-out infinite"
                    : undefined,
            }}
        />
    );
}
