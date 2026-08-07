import { MANA_COLORS } from "@convex/gre/manaColors";
import type { DeckStats } from "~/lib/deckStats";
import DeckStatsColorRow from "./deck-stats-color-row";

export interface DeckStatsManaSectionProps {
    stats: Pick<DeckStats, "pips" | "sources">;
}

/**
 * The Stats dialog's mana section (PRD #1617 § "Stats dialog", issue
 * #1631): every colour that appears either as a pip or as a source, each on
 * its own {@link DeckStatsColorRow}. `"C"` is excluded — colourless is not a
 * colour (CR 202.2) — and a colour with neither pips nor sources is omitted
 * rather than rendered as an empty row.
 *
 * All counting is `stats.pips` / `stats.sources` from `computeDeckStats`;
 * this component only decides WHICH colours to show and the shared
 * `maxTotal` every row's bar length is scaled against.
 */
export default function DeckStatsManaSection({
    stats,
}: DeckStatsManaSectionProps) {
    const colors = MANA_COLORS.filter(
        (c) =>
            c !== "C" &&
            ((stats.pips[c] ?? 0) > 0 ||
                (stats.sources.lands[c] ?? 0) > 0 ||
                (stats.sources.nonlands[c] ?? 0) > 0)
    );
    const maxTotal = Math.max(
        1,
        ...colors.map(
            (c) =>
                (stats.sources.lands[c] ?? 0) + (stats.sources.nonlands[c] ?? 0)
        )
    );

    return (
        <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                    Pips vs. Sources
                </h3>
                <div className="flex items-center gap-4 text-xs text-text-muted">
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block size-2 rounded-full bg-accent" />
                        Lands
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="inline-block size-2 rounded-full bg-secondary-accent" />
                        Other sources
                    </span>
                </div>
            </div>

            {colors.length === 0 ? (
                <p className="text-sm text-text-muted">
                    No coloured mana costs or sources in the Maindeck yet.
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {colors.map((color) => (
                        <DeckStatsColorRow
                            key={color}
                            color={color}
                            pipCount={stats.pips[color] ?? 0}
                            landCount={stats.sources.lands[color] ?? 0}
                            nonlandCount={stats.sources.nonlands[color] ?? 0}
                            maxTotal={maxTotal}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
