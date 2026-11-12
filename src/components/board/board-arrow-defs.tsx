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
