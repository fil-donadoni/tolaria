// PROTOTYPE — throwaway. The Arena-style circular table: 8 seats on a ring,
// the viewer at the bottom, seatIndex+1 on the viewer's LEFT (clockwise on
// screen), so "passing left" flows clockwise. While drafting, chevrons and
// a moving dash on the track show which way the packs go.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import RingSeat from "./ring-seat";
import RingCenterInfo from "./ring-center-info";
import { EVENT_META, passDirectionFor } from "./event-mock";
import type { EventProto } from "./use-event-proto";

const CY = 47;

export default function TableRing({
    p,
    radius = 37,
    center,
    className,
}: {
    p: EventProto;
    /** Ring radius in % of the box width. */
    radius?: number;
    /** Replaces the default centre read-out (variant B puts the hero here). */
    center?: ReactNode;
    className?: string;
}) {
    const n = p.seats.length;
    const drafting = p.phase === "drafting";
    const dir = passDirectionFor(EVENT_META.draftPack);
    const clockwise = dir === "left";
    const pos = (k: number) => {
        const a = ((90 + (k * 360) / n) * Math.PI) / 180;
        return {
            x: 50 + radius * Math.cos(a),
            y: CY + radius * Math.sin(a),
            a,
        };
    };
    const box = useRef<HTMLDivElement>(null);
    const [dense, setDense] = useState(false);
    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) =>
            setDense(e.contentRect.width < 380)
        );
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    const feltR = radius - (dense ? 12 : 9);
    const uid = useId().replace(/:/g, "");
    return (
        <div className={cn("w-full pb-4", className)}>
            <div ref={box} className="relative aspect-square w-full">
                <svg
                    viewBox="0 0 100 100"
                    className="absolute inset-0 h-full w-full overflow-visible"
                    aria-hidden
                >
                    <style>{`
                        @keyframes proto-ring-cw { to { stroke-dashoffset: -6.4; } }
                        @keyframes proto-ring-ccw { to { stroke-dashoffset: 6.4; } }
                    `}</style>
                    <defs>
                        <radialGradient
                            id={`felt-${uid}`}
                            cx="50%"
                            cy="45%"
                            r="60%"
                        >
                            <stop
                                offset="0%"
                                stopColor="var(--color-surface-elevated)"
                            />
                            <stop
                                offset="100%"
                                stopColor="var(--color-surface-base)"
                            />
                        </radialGradient>
                        <clipPath id={`clip-${uid}`}>
                            <circle cx="50" cy={CY} r={feltR} />
                        </clipPath>
                    </defs>
                    <circle
                        cx="50"
                        cy={CY}
                        r={feltR + 1.2}
                        fill="none"
                        stroke="var(--color-border-strong)"
                        strokeWidth="0.4"
                    />
                    <circle
                        cx="50"
                        cy={CY}
                        r={feltR}
                        fill={`url(#felt-${uid})`}
                    />
                    <image
                        href={getArtCropImageUrl(EVENT_META.featureCard.id)}
                        x={50 - feltR}
                        y={CY - feltR}
                        width={feltR * 2}
                        height={feltR * 2}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#clip-${uid})`}
                        opacity={center ? 0.12 : 0.22}
                    />
                    <circle
                        cx="50"
                        cy={CY}
                        r={radius}
                        fill="none"
                        stroke={
                            drafting
                                ? "var(--color-accent)"
                                : "var(--color-border-strong)"
                        }
                        strokeOpacity={drafting ? 0.55 : 0.6}
                        strokeWidth="0.5"
                        strokeDasharray={drafting ? "1.2 2" : "0.6 1.6"}
                        style={
                            drafting
                                ? {
                                      animation: `${clockwise ? "proto-ring-cw" : "proto-ring-ccw"} 1.6s linear infinite`,
                                  }
                                : undefined
                        }
                    />
                    {drafting &&
                        Array.from({ length: n }, (_, k) => {
                            const mid = pos(k + 0.5);
                            const deg =
                                (mid.a * 180) / Math.PI +
                                (clockwise ? 90 : -90);
                            return (
                                <path
                                    key={k}
                                    d="M -1.2 -1.6 L 1 0 L -1.2 1.6"
                                    fill="none"
                                    stroke="var(--color-accent-strong)"
                                    strokeWidth="0.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    transform={`translate(${mid.x} ${mid.y}) rotate(${deg})`}
                                />
                            );
                        })}
                </svg>
                <div
                    className="absolute flex items-center justify-center text-center"
                    style={{
                        left: `${50 - feltR}%`,
                        top: `${CY - feltR}%`,
                        width: `${feltR * 2}%`,
                        height: `${feltR * 2}%`,
                    }}
                >
                    {center ?? <RingCenterInfo p={p} dense={dense} />}
                </div>
                {p.seats.map((seat, i) => {
                    const { x, y } = pos(i);
                    return (
                        <RingSeat
                            key={seat.seatIndex}
                            seat={seat}
                            phase={p.phase}
                            x={x}
                            y={y}
                            dense={dense}
                            viewerIsVisitor={p.viewpoint === "visitor"}
                            onJoin={() => p.setViewpoint("creator")}
                        />
                    );
                })}
            </div>
        </div>
    );
}
