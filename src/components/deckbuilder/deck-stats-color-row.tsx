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
    const landsPct = total > 0 ? (landCount / total) * 100 : 0;
    const nonlandsPct = total > 0 ? (nonlandCount / total) * 100 : 0;

    return (
        <div className="flex items-center gap-3">
            <ManaSymbol symbol={color} className="size-5 shrink-0" />
            <span className="w-16 shrink-0 text-xs text-text-muted">
                {pipCount} pip{pipCount === 1 ? "" : "s"}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                <div
                    className="flex h-full"
                    style={{ width: `${totalWidthPct}%` }}
                >
                    <div
                        className="h-full bg-accent"
                        style={{ width: `${landsPct}%` }}
                    />
                    <div
                        className="h-full bg-secondary-accent"
                        style={{ width: `${nonlandsPct}%` }}
                    />
                </div>
            </div>
            <span className="w-40 shrink-0 text-right text-xs text-text-muted">
                {total} source{total === 1 ? "" : "s"} ({landCount} land
                {landCount === 1 ? "" : "s"} + {nonlandCount} other)
            </span>
        </div>
    );
}
