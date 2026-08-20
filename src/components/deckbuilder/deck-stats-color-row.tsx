import type { Color } from "@convex/cards/types";
import ManaSymbol from "~/components/cards/mana-symbol";

export interface DeckStatsColorRowProps {
    color: Color;
    pipCount: number;
    landCount: number;
    nonlandCount: number;
    /** The largest (lands + nonlands) total across every row in the section
     *  — computed once by the caller so every row's bar LENGTH is
     *  comparable across colours, not just its own internal land/nonland
     *  split. */
    maxTotal: number;
}

/**
 * One colour's line in the Stats dialog's mana section (PRD #1617 §
 * "Stats dialog", issue #1631): the pip count sits next to the source
 * count, "so the question 'do I have the mana for what I am asking?' is
 * answerable in one look" — and the source bar itself is split into a
 * lands segment and a non-lands segment (`bg-accent` / `bg-secondary-accent`,
 * semantic role tokens, never a raw chromatic value).
 *
 * `pipCount` / `landCount` / `nonlandCount` all come from `DeckStats` as
 * computed by `computeDeckStats` — this component does no counting, only
 * the bar-width layout arithmetic (a fraction of `maxTotal`).
 */
export default function DeckStatsColorRow({
    color,
    pipCount,
    landCount,
    nonlandCount,
    maxTotal,
}: DeckStatsColorRowProps) {
    const total = landCount + nonlandCount;
    const totalWidthPct = maxTotal > 0 ? (total / maxTotal) * 100 : 0;

    return (
        <div className="flex items-center gap-3 short-viewport:gap-2">
            <ManaSymbol
                symbol={color}
                className="size-5 shrink-0 short-viewport:size-4"
            />
            <span className="w-16 shrink-0 text-xs text-text-muted">
                {pipCount} pip{pipCount === 1 ? "" : "s"}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-elevated short-viewport:h-2">
                <div
                    // `gap-[2px]`: the surface-color spacer between the
                    // lands/nonlands segments (dataviz skill, marks-and-
                    // anatomy.md "surface gap" — every touching segment of a
                    // stacked bar gets one). `flex-grow` on each segment
                    // below partitions the width by count directly, so the
                    // gap never has to be subtracted out of a percentage by
                    // hand (issue #2586).
                    className="flex h-full gap-[2px]"
                    style={{ width: `${totalWidthPct}%` }}
                >
                    {landCount > 0 && (
                        <div
                            className="h-full bg-accent"
                            style={{ flexGrow: landCount, flexBasis: 0 }}
                            title={`${landCount} land source${landCount === 1 ? "" : "s"}`}
                        />
                    )}
                    {nonlandCount > 0 && (
                        <div
                            className="h-full bg-secondary-accent"
                            style={{ flexGrow: nonlandCount, flexBasis: 0 }}
                            title={`${nonlandCount} other source${nonlandCount === 1 ? "" : "s"}`}
                        />
                    )}
                </div>
            </div>
            <span className="w-40 shrink-0 text-right text-xs text-text-muted short-viewport:w-auto">
                {total} source{total === 1 ? "" : "s"} ({landCount} land
                {landCount === 1 ? "" : "s"} + {nonlandCount} other)
            </span>
        </div>
    );
}
