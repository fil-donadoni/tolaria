// PROTOTYPE — throwaway. Builder header: deck name (seeded from the Pack
// Source), Pack Source chip, deck count, group-by control and the coupled
// sort chip, and the creature filter (optional — variant B's phone tabs
// replace it).
import { PencilIcon } from "lucide-react";
import SegmentedControl from "~/components/ui/segmented-control";
import { cn } from "~/lib/utils";
import { DEFAULT_SORT, type GroupBy, type TypeFilter } from "./builder-data";
import PackSourceChip from "./pack-source-chip";
import SortChip from "./sort-chip";
import SplitToggle from "./split-toggle";
import type { Builder } from "./useBuilder";

const GROUP_OPTIONS = [
    { value: "mv", label: "Mana value" },
    { value: "color", label: "Colour" },
] as const;
const FILTER_OPTIONS = [
    { value: "all", label: "All" },
    { value: "creatures", label: "Creatures" },
    { value: "non-creatures", label: "Non-creatures" },
] as const;

export default function BuilderToolbar({
    b,
    showFilter = true,
    compact = false,
    showSplit = false,
}: {
    b: Builder;
    showFilter?: boolean;
    compact?: boolean;
    /** Show the "Split creatures" switch (variant d). */
    showSplit?: boolean;
}) {
    const total = b.deck.length + b.basicsTotal;
    return (
        <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-3")}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <label className="group relative flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
                    <span className="sr-only">Deck name</span>
                    <input
                        value={b.deckName}
                        onChange={(e) => b.setDeckName(e.target.value)}
                        className={cn(
                            "min-w-0 flex-1 truncate rounded-sm border border-transparent bg-transparent px-1 font-display text-parchment outline-none transition hover:border-border-subtle/50 focus:border-accent",
                            compact ? "text-lg" : "text-2xl sm:text-3xl"
                        )}
                    />
                    <PencilIcon className="size-3.5 shrink-0 text-text-disabled group-hover:text-text-muted" />
                </label>
                <PackSourceChip />
                <span
                    className={cn(
                        "ml-auto rounded-sm border px-2 py-0.5 text-xs font-semibold tabular-nums",
                        total === 40
                            ? "border-emerald-500/50 text-emerald-300"
                            : "border-amber-500/50 text-amber-300"
                    )}
                    title={`${b.deck.length} spells + ${b.basicsTotal} basics`}
                >
                    {total} / 40
                </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-disabled">
                    Group
                </span>
                <SegmentedControl
                    ariaLabel="Group piles by"
                    options={GROUP_OPTIONS}
                    value={b.groupBy}
                    onChange={(v) => b.setGroupBy(v as GroupBy)}
                />
                <SortChip
                    sortBy={b.sortBy}
                    setSortBy={b.setSortBy}
                    flip={b.sortFlip}
                    isDefault={b.sortBy === DEFAULT_SORT[b.groupBy]}
                />
                {showSplit && (
                    <SplitToggle on={b.split} onChange={b.setSplit} />
                )}
                {showFilter && (
                    <SegmentedControl
                        ariaLabel="Filter by card type"
                        className="sm:ml-auto"
                        options={FILTER_OPTIONS}
                        value={b.filter}
                        onChange={(v) => b.setFilter(v as TypeFilter)}
                    />
                )}
            </div>
        </div>
    );
}
