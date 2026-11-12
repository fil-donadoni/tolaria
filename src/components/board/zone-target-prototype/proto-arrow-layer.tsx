// PROTOTYPE (zone-target highlight) — gold filament arrows in viewport
// coordinates, styled like BoardArrows. Variants pass the paths they want;
// `dim` paths sit outside the hovered relationship.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { publishArrows } from "./proto-arrow-registry";
import type { CurveGeo } from "./use-zone-target-model";

export type ProtoPath = {
    key: string;
    /** A straight/dashed path (tethers) — not hover-testable. */
    d?: string;
    /** A targeting arrow — drawn from its geometry and hover-testable. */
    geo?: CurveGeo;
    /** The relationship(s) this arrow belongs to (hover focus). */
    groups?: string[];
    dashed?: boolean;
    thin?: boolean;
    dim?: boolean;
    emphasized?: boolean;
};

export default function ProtoArrowLayer({ paths }: { paths: ProtoPath[] }) {
    useEffect(() => {
        publishArrows(
            paths.flatMap((p) =>
                p.geo && p.groups ? [{ geo: p.geo, groups: p.groups }] : []
            )
        );
    });
    useEffect(() => () => publishArrows([]), []);
    return createPortal(
        <svg className="pointer-events-none fixed inset-0 z-[101] h-full w-full overflow-visible">
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
                <g
                    key={p.key}
                    opacity={p.dim ? 0.12 : 1}
                    style={{ transition: "opacity 140ms ease" }}
                >
                    {!p.thin && (
                        <path
                            d={p.geo?.d ?? p.d}
                            fill="none"
                            stroke="var(--color-accent)"
                            strokeWidth={p.emphasized ? 9 : 6}
                            strokeLinecap="round"
                            opacity={p.emphasized ? 0.32 : 0.18}
                        />
                    )}
                    <path
                        d={p.geo?.d ?? p.d}
                        fill="none"
                        stroke="var(--color-accent-strong)"
                        strokeWidth={p.thin ? 1.4 : p.emphasized ? 3.2 : 2.4}
                        strokeDasharray={p.dashed ? "4 4" : undefined}
                        strokeLinecap="round"
                        markerEnd={p.dashed ? undefined : "url(#proto-zt-head)"}
                    />
                </g>
            ))}
        </svg>,
        document.body
    );
}
