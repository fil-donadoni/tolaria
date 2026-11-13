import {
    ARROW_ACCENT,
    ARROW_STRONG,
    type ArrowDefIds,
} from "~/lib/board-arrow-style";

/** The shared `<defs>` an arrow `<g>` references. */
export default function ArrowDefs({ ids }: { ids: ArrowDefIds }) {
    return (
        <defs>
            <linearGradient id={ids.grad} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={ARROW_ACCENT} />
                <stop offset="100%" stopColor={ARROW_STRONG} />
            </linearGradient>
            {/* Crisp ornamental arrowhead, bright filament colour. */}
            <marker
                id={ids.head}
                markerWidth="9"
                markerHeight="9"
                refX="6"
                refY="4"
                orient="auto"
                markerUnits="userSpaceOnUse"
            >
                <path
                    d="M0,0.5 L8.5,4 L0,7.5 Q3,4 0,0.5 Z"
                    fill={ARROW_STRONG}
                />
            </marker>
            {/* PROTOTYPE (issue #9500): origin socket — a gold ring with a
                dark core where the arrow leaves its source, so a wire reads
                as FROM this card, not just TO its target. */}
            {ids.tail && (
                <marker
                    id={ids.tail}
                    markerWidth="16"
                    markerHeight="16"
                    refX="8"
                    refY="8"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                >
                    <circle
                        cx="8"
                        cy="8"
                        r="5.5"
                        fill="#111"
                        stroke={ARROW_STRONG}
                        strokeWidth="2.2"
                    />
                    <circle cx="8" cy="8" r="2" fill={ARROW_STRONG} />
                </marker>
            )}
            <filter
                id={ids.shadow}
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
            >
                <feDropShadow
                    dx="0"
                    dy="1"
                    stdDeviation="1.6"
                    floodColor="#000"
                    floodOpacity="0.4"
                />
            </filter>
        </defs>
    );
}
