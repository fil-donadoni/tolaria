// PROTOTYPE — throwaway. A card tile for the gesture prototype: plain <img>
// (no CardImage — its hover/long-press preview is exactly the gesture we are
// re-deciding), selection ring, optional ×N copies badge, optional C-model grip.
import { getImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import type { ProtoCard } from "./mock-pool";

export default function TouchCardTile({
    card,
    width,
    selected,
    copies,
    showHandle,
    cardProps,
    handleProps,
    className,
    style,
}: {
    card: ProtoCard;
    width: number;
    selected: boolean;
    copies?: number;
    showHandle?: boolean;
    cardProps: Record<string, unknown>;
    handleProps?: Record<string, unknown>;
    className?: string;
    style?: React.CSSProperties;
}) {
    return (
        <div
            {...cardProps}
            className={cn(
                "relative shrink-0 overflow-visible rounded-[6%] aspect-5/7",
                selected && "z-10",
                className
            )}
            style={{
                width,
                ...(cardProps.style as React.CSSProperties),
                ...style,
            }}
        >
            <img
                src={getImageUrl(card.cardId)}
                alt={card.name}
                draggable={false}
                className={cn(
                    "block h-full w-full rounded-[6%] object-cover shadow-[0_2px_6px_rgba(0,0,0,.6)]",
                    selected &&
                        "ring-[3px] ring-accent shadow-[0_0_0_5px_rgba(201,162,75,.35)]"
                )}
            />
            {copies && copies > 1 ? (
                <span className="pointer-events-none absolute right-1 bottom-1 rounded-full bg-accent-strong px-1.5 text-[11px] font-bold text-surface-base shadow">
                    ×{copies}
                </span>
            ) : null}
            {showHandle && selected && handleProps ? (
                <button
                    type="button"
                    aria-label="Drag handle"
                    {...handleProps}
                    className="absolute -top-3 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full border border-accent bg-surface-elevated text-accent-strong shadow-[0_4px_12px_rgba(0,0,0,.7)]"
                    style={{ ...(handleProps.style as React.CSSProperties) }}
                >
                    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                        <circle cx="9" cy="6" r="1.6" />
                        <circle cx="15" cy="6" r="1.6" />
                        <circle cx="9" cy="12" r="1.6" />
                        <circle cx="15" cy="12" r="1.6" />
                        <circle cx="9" cy="18" r="1.6" />
                        <circle cx="15" cy="18" r="1.6" />
                    </svg>
                </button>
            ) : null}
        </div>
    );
}
