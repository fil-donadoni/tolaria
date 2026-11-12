// PROTOTYPE (zone-target highlight) — a sized real CardImage (hover preview
// included). A TARGETED card is marked as INFORMATION, never as an affordance
// (owner feedback 2026-11-12: the white ring already means "you can interact
// with this" in our UX vocabulary): gold reticle corner brackets OUTSIDE the
// card + a small crosshair tag, no ring, no glow, default cursor.
import CardImage from "~/components/cards/card-image";
import type { CardInstance } from "~/types/game";

const ARM = 9;

function Corner({ pos }: { pos: "tl" | "tr" | "bl" | "br" }) {
    const v = pos[0] === "t" ? "top" : "bottom";
    const h = pos[1] === "l" ? "left" : "right";
    return (
        <span
            aria-hidden
            className="absolute border-accent-strong"
            style={{
                [v]: -5,
                [h]: -5,
                width: ARM,
                height: ARM,
                [`border${v === "top" ? "Top" : "Bottom"}Width`]: 2,
                [`border${h === "left" ? "Left" : "Right"}Width`]: 2,
            }}
        />
    );
}

export function Crosshair({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
            <circle
                cx="8"
                cy="8"
                r="5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
            />
            <path
                d="M8 0v4M8 12v4M0 8h4M12 8h4"
                stroke="currentColor"
                strokeWidth="1.6"
            />
        </svg>
    );
}

export default function ProtoThumb({
    card,
    width,
    marked,
    dim,
    rotate = 0,
    group,
    measureId,
}: {
    card: CardInstance;
    width: number;
    marked?: boolean;
    dim?: boolean;
    rotate?: number;
    /** Space-separated group keys — feeds the hover focus. */
    group?: string;
    /** `data-proto-measure` value, for variants that aim arrows at it. */
    measureId?: string;
}) {
    return (
        <div
            data-proto-group={group}
            data-proto-measure={measureId}
            className="pointer-events-auto relative shrink-0 cursor-default transition-opacity duration-150"
            style={{
                width,
                height: width * 1.395,
                opacity: dim ? 0.18 : 1,
                transform: `rotate(${rotate}deg)`,
            }}
        >
            <div className="absolute inset-0 overflow-hidden rounded-[6%]">
                <CardImage card={card} sizes={`${width}px`} includeThumb />
            </div>
            {marked && (
                <>
                    <Corner pos="tl" />
                    <Corner pos="tr" />
                    <Corner pos="bl" />
                    <Corner pos="br" />
                    <span className="absolute -top-2 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full bg-surface-base p-[2px] text-accent-strong shadow">
                        <Crosshair size={width < 40 ? 10 : 13} />
                    </span>
                </>
            )}
        </div>
    );
}
