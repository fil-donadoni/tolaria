// PROTOTYPE (zone-target highlight) — a sized real CardImage (hover preview
// included), optionally ringed as "targeted".
import CardImage from "~/components/cards/card-image";
import type { CardInstance } from "~/types/game";

export default function ProtoThumb({
    card,
    width,
    targeted,
    dim,
    rotate = 0,
    badge,
}: {
    card: CardInstance;
    width: number;
    targeted?: boolean;
    dim?: boolean;
    rotate?: number;
    badge?: string;
}) {
    return (
        <div
            className={`pointer-events-auto relative shrink-0 overflow-visible rounded-[6%] transition-opacity ${
                targeted
                    ? "shadow-[0_0_14px_3px_var(--color-accent)] ring-2 ring-accent-strong"
                    : ""
            }`}
            style={{
                width,
                height: width * 1.395,
                opacity: dim ? 0.3 : 1,
                transform: `rotate(${rotate}deg)`,
            }}
        >
            <div className="absolute inset-0 overflow-hidden rounded-[6%]">
                <CardImage card={card} sizes={`${width}px`} includeThumb />
            </div>
            {badge && (
                <span className="absolute -right-1.5 -top-1.5 rounded-full bg-accent-strong px-1.5 text-[10px] font-bold text-black ring-1 ring-black/50">
                    {badge}
                </span>
            )}
        </div>
    );
}
