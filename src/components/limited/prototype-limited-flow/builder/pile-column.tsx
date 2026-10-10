// PROTOTYPE — throwaway. One overlapped pile (MTGO stack): optional header
// (label or mana symbol + count), cards fanned down by `--peek`. `slots`
// reserves height for N cards so piles in one row can share a baseline.
import ManaSymbol from "~/components/cards/mana-symbol";
import { cn } from "~/lib/utils";
import type { ProtoCard } from "../proto-cards";
import { pileHeight, type Column } from "./builder-data";
import PileCard from "./pile-card";

export default function PileColumn({
    column,
    onCardClick,
    slots,
    showHeader = true,
    dim = false,
}: {
    column: Column;
    onCardClick: (card: ProtoCard, el: Element) => void;
    slots?: number;
    showHeader?: boolean;
    dim?: boolean;
}) {
    const n = column.cards.length;
    return (
        <div
            className={cn(
                "flex w-(--cw) shrink-0 flex-col gap-1.5 transition-opacity",
                dim && "opacity-35"
            )}
        >
            {showHeader && (
                <div className="flex h-5 items-center justify-between gap-1 border-b border-border-subtle/40 pb-1 text-[11px] font-semibold text-text-muted">
                    {column.symbol ? (
                        <ManaSymbol symbol={column.symbol} className="size-4" />
                    ) : (
                        <span className="truncate uppercase tracking-wide">
                            {column.label}
                        </span>
                    )}
                    <span className="tabular-nums text-text-disabled">{n}</span>
                </div>
            )}
            <div
                className="relative w-(--cw)"
                style={{ height: pileHeight(Math.max(n, slots ?? 0)) }}
            >
                {n === 0 && (
                    <div className="absolute inset-x-0 top-0 h-[calc(var(--cw)*0.5)] rounded-[calc(var(--cw)*0.048)] border border-dashed border-border-subtle/40" />
                )}
                {column.cards.map((c, i) => (
                    <PileCard
                        key={c.name}
                        card={c}
                        index={i}
                        onClick={onCardClick}
                    />
                ))}
            </div>
        </div>
    );
}
