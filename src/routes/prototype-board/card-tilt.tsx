/**
 * PROTOTYPE — DOM card with Arena-style CSS 3D tilt-to-cursor + moving glare.
 * Pure CSS transforms, written imperatively on pointermove (no React state
 * churn). Throwaway — delete after decision.
 */

import { useRef } from "react";
import { SCRYFALL_NORMAL } from "./cards";

const MAX_TILT = 14; // degrees

export default function CardTilt({
    cardId,
    name,
    power,
    toughness,
    faceDown = false,
    scale = 1,
    registerEl,
    onPointerEnterCard,
    onPointerLeaveCard,
}: {
    cardId: string;
    name: string;
    power?: number;
    toughness?: number;
    faceDown?: boolean;
    scale?: number;
    registerEl?: (el: HTMLElement | null) => void;
    onPointerEnterCard?: () => void;
    onPointerLeaveCard?: () => void;
}) {
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const glare = useRef<HTMLDivElement>(null);

    function onMove(e: React.PointerEvent) {
        const el = outer.current;
        const i = inner.current;
        const g = glare.current;
        if (!el || !i) return;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        i.style.transition = "transform 60ms linear";
        i.style.transform = `rotateX(${-py * MAX_TILT}deg) rotateY(${px * MAX_TILT}deg) translateZ(28px) scale(1.07)`;
        if (g) {
            g.style.opacity = "0.55";
            g.style.background = `radial-gradient(circle at ${(px + 0.5) * 100}% ${(py + 0.5) * 100}%, rgba(255,255,255,0.85), rgba(255,255,255,0) 55%)`;
        }
    }

    function reset() {
        const i = inner.current;
        const g = glare.current;
        if (i) {
            i.style.transition = "transform 320ms cubic-bezier(0.22,1,0.36,1)";
            i.style.transform = "rotateX(0) rotateY(0) translateZ(0) scale(1)";
        }
        if (g) g.style.opacity = "0";
        onPointerLeaveCard?.();
    }

    return (
        <div
            ref={(n) => {
                outer.current = n;
                registerEl?.(n);
            }}
            onPointerMove={onMove}
            onPointerEnter={onPointerEnterCard}
            onPointerLeave={reset}
            className="absolute top-0 left-0"
            style={{
                width: `calc(var(--pt-cw) * ${scale})`,
                height: `calc(var(--pt-ch) * ${scale})`,
                marginLeft: `calc(var(--pt-cw) * ${scale} / -2)`,
                marginTop: `calc(var(--pt-ch) * ${scale} / -2)`,
                perspective: "700px",
            }}
        >
            <div
                ref={inner}
                className="relative w-full h-full rounded-[7px] overflow-hidden shadow-[0_8px_22px_rgba(0,0,0,0.65)] ring-1 ring-black/50 will-change-transform"
                style={{ transformStyle: "preserve-3d" }}
            >
                {faceDown ? (
                    <div className="w-full h-full bg-gradient-to-br from-[#2a2438] to-[#15101f] grid place-items-center">
                        <div className="w-[55%] h-[55%] rounded-full border-2 border-amber-700/40 bg-amber-900/10" />
                    </div>
                ) : (
                    <>
                        <img
                            src={SCRYFALL_NORMAL(cardId)}
                            alt={name}
                            draggable={false}
                            className="w-full h-full object-cover select-none"
                        />
                        {power !== undefined && (
                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-white text-[12px] font-bold leading-none tabular-nums">
                                {power}/{toughness}
                            </div>
                        )}
                    </>
                )}
                {/* glare — moves with the tilt */}
                <div
                    ref={glare}
                    className="absolute inset-0 pointer-events-none mix-blend-overlay opacity-0 transition-opacity"
                />
            </div>
        </div>
    );
}
