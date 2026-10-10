// PROTOTYPE — throwaway. "Sorted by Colour ▾": the coupled sort, visibly
// flashing when a group-by change flips it, still overridable by hand.
import { useEffect, useRef } from "react";
import { ArrowDownUpIcon } from "lucide-react";
import { SORT_LABEL, type SortBy } from "./builder-data";

export default function SortChip({
    sortBy,
    setSortBy,
    flip,
    isDefault,
}: {
    sortBy: SortBy;
    setSortBy: (s: SortBy) => void;
    flip: number;
    isDefault: boolean;
}) {
    const ref = useRef<HTMLLabelElement>(null);
    useEffect(() => {
        if (flip === 0 || !ref.current) return;
        ref.current.animate(
            [
                {
                    backgroundColor: "var(--color-accent)",
                    color: "var(--color-surface-base)",
                    transform: "scale(1.08)",
                },
                { backgroundColor: "transparent", transform: "scale(1)" },
            ],
            { duration: 900, easing: "ease-out" }
        );
    }, [flip]);
    return (
        <label
            ref={ref}
            className="relative inline-flex min-h-(--control-h-sm) items-center gap-1.5 rounded-sm border border-border-strong px-2 text-xs text-text-muted"
        >
            <ArrowDownUpIcon className="size-3.5 opacity-70" />
            <span className="hidden sm:inline">Sorted by</span>
            <span className="font-semibold text-parchment">
                {SORT_LABEL[sortBy]}
            </span>
            {isDefault && (
                <span className="text-[10px] uppercase tracking-wide text-text-disabled">
                    auto
                </span>
            )}
            <select
                aria-label="Sort cards within a pile"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="absolute inset-0 cursor-pointer opacity-0"
            >
                {(Object.keys(SORT_LABEL) as SortBy[]).map((s) => (
                    <option key={s} value={s}>
                        {SORT_LABEL[s]}
                    </option>
                ))}
            </select>
        </label>
    );
}
