// PROTOTYPE — throwaway. True MTGO layout: ONE grid of columns (by mana
// value or colour); inside each column the creature stack sits above a
// horizontal divider that runs across the whole grid, non-creature stack
// below. Creature stacks reserve the tallest stack's height so the divider
// is one straight line. Mana-value columns stay even when empty (the curve
// gap is information); empty colour columns drop. The creature filter dims a half instead of hiding it.
import ManaSymbol from "~/components/cards/mana-symbol";
import { cn } from "~/lib/utils";
import type { ProtoCard } from "../proto-cards";
import {
    buildColumns,
    isCreature,
    type GroupBy,
    type SortBy,
    type TypeFilter,
} from "./builder-data";
import PileColumn from "./pile-column";

export default function MtgoCombinedGrid({
    cards,
    groupBy,
    sortBy,
    filter,
    onCardClick,
    showHeaders = true,
}: {
    cards: ProtoCard[];
    groupBy: GroupBy;
    sortBy: SortBy;
    filter: TypeFilter;
    onCardClick: (card: ProtoCard, el: Element) => void;
    showHeaders?: boolean;
}) {
    const columns = buildColumns(cards, groupBy, sortBy, groupBy === "mv");
    const split = columns.map((col) => ({
        col,
        top: { ...col, cards: col.cards.filter(isCreature) },
        bottom: { ...col, cards: col.cards.filter((c) => !isCreature(c)) },
    }));
    const creatureSlots = Math.max(1, ...split.map((s) => s.top.cards.length));
    const nCreatures = split.reduce((n, s) => n + s.top.cards.length, 0);
    const nSpells = cards.length - nCreatures;

    return (
        <div
            data-hscroll
            className="overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin]"
        >
            <div
                className="grid w-max gap-x-2 sm:gap-x-3"
                style={{
                    gridTemplateColumns: `repeat(${split.length}, var(--cw))`,
                    gridTemplateRows: "auto auto auto auto",
                }}
            >
                {showHeaders &&
                    split.map(({ col }) => (
                        <div
                            key={`h-${col.key}`}
                            className="row-start-1 flex h-6 items-center justify-between border-b border-border-subtle/40 pb-1 text-[11px] font-semibold text-text-muted"
                        >
                            {col.symbol ? (
                                <ManaSymbol
                                    symbol={col.symbol}
                                    className="size-4"
                                />
                            ) : (
                                <span className="truncate uppercase tracking-wide">
                                    {col.label}
                                </span>
                            )}
                            <span className="tabular-nums text-text-disabled">
                                {col.cards.length}
                            </span>
                        </div>
                    ))}
                {split.map(({ col, top }) => (
                    <div
                        key={`t-${col.key}`}
                        className="row-start-2 pt-2"
                        style={{ gridColumn: "auto" }}
                    >
                        <PileColumn
                            column={top}
                            onCardClick={onCardClick}
                            slots={creatureSlots}
                            showHeader={false}
                            dim={filter === "non-creatures"}
                        />
                    </div>
                ))}
                <div className="relative col-span-full row-start-3 my-2 flex h-6 items-center">
                    <span className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-emerald-400/70 via-border-strong to-sky-400/70" />
                    <span className="sticky left-0 z-10 flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border-strong bg-surface-base px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]">
                        <span
                            className={cn(
                                "text-emerald-300",
                                filter === "non-creatures" && "opacity-40"
                            )}
                        >
                            ▲ Creatures {nCreatures}
                        </span>
                        <span className="text-text-disabled">·</span>
                        <span
                            className={cn(
                                "text-sky-300",
                                filter === "creatures" && "opacity-40"
                            )}
                        >
                            ▼ Non-creatures {nSpells}
                        </span>
                    </span>
                </div>
                {split.map(({ col, bottom }) => (
                    <div key={`b-${col.key}`} className="row-start-4">
                        <PileColumn
                            column={bottom}
                            onCardClick={onCardClick}
                            showHeader={false}
                            dim={filter === "creatures"}
                        />
                    </div>
                ))}
            </div>
        </div>
    );
}
