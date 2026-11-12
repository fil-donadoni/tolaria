// PROTOTYPE (zone-target highlight) — gold filament arrows in viewport
// coordinates, styled like BoardArrows. Variants pass the paths they want.
export type ProtoPath = {
    key: string;
    d: string;
    dashed?: boolean;
    thin?: boolean;
};

export default function ProtoArrowLayer({ paths }: { paths: ProtoPath[] }) {
    return (
        <svg className="pointer-events-none fixed inset-0 z-[900] h-full w-full overflow-visible">
            <defs>
                <marker
                    id="proto-zt-head"
                    markerWidth="9"
                    markerHeight="9"
                    refX="6"
                    refY="4"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                >
                    <path
                        d="M0,0.5 L8.5,4 L0,7.5 Q3,4 0,0.5 Z"
                        fill="var(--color-accent-strong)"
                    />
                </marker>
            </defs>
            {paths.map((p) => (
                <g key={p.key}>
                    {!p.thin && (
                        <path
                            d={p.d}
                            fill="none"
                            stroke="var(--color-accent)"
                            strokeWidth={7}
                            strokeLinecap="round"
                            opacity={0.22}
                        />
                    )}
                    <path
                        d={p.d}
                        fill="none"
                        stroke="var(--color-accent-strong)"
                        strokeWidth={p.thin ? 1.4 : 2.6}
                        strokeDasharray={p.dashed ? "4 4" : undefined}
                        strokeLinecap="round"
                        markerEnd={p.dashed ? undefined : "url(#proto-zt-head)"}
                    />
                </g>
            ))}
        </svg>
    );
}
