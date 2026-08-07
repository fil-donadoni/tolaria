import { useMemo } from "react";
import GameDialog from "~/components/ui/game-dialog";
import { computeDeckStats } from "~/lib/deckStats";
import type { ZoneCard } from "~/types/game";
import DeckStatsCurveChart from "./deck-stats-curve-chart";
import DeckStatsManaSection from "./deck-stats-mana-section";
import DeckStatsTypeList from "./deck-stats-type-list";

export interface DeckStatsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The Maindeck only — never the Sideboard (PRD #1617 § "Stats dialog":
     *  "the Sideboard must not distort the picture of what will actually be
     *  played"). The caller picks the list; this component and
     *  `computeDeckStats` both stay agnostic of sideboarding. */
    mainCards: ZoneCard[];
}

/**
 * The Stats dialog (PRD #1617 § "Stats dialog", issue #1631) — an on-demand
 * popup, never rendered inline in the builder, reporting the Maindeck's mana
 * curve, coloured pips vs. sources, and type/subtype counts.
 *
 * Every number comes from `computeDeckStats` (`src/lib/deckStats.ts`) —
 * this component and its children (`DeckStatsCurveChart`,
 * `DeckStatsManaSection`, `DeckStatsTypeList`) do no counting of their own,
 * only sorting and bar-size layout arithmetic on numbers already computed.
 */
export default function DeckStatsDialog({
    open,
    onOpenChange,
    mainCards,
}: DeckStatsDialogProps) {
    const stats = useMemo(() => computeDeckStats(mainCards), [mainCards]);

    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Deck Statistics"
            subtitle="Maindeck only — the Sideboard is not counted."
            size="wide"
            showCloseButton
        >
            <div className="flex flex-col gap-6">
                <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
                        Mana Curve
                    </h3>
                    <p className="text-xs text-text-muted">
                        Lands excluded; an unpaid {"{X}"} counts as 0.
                    </p>
                    <DeckStatsCurveChart curve={stats.curve} />
                </section>

                <DeckStatsManaSection stats={stats} />

                <div className="grid gap-6 sm:grid-cols-2">
                    <DeckStatsTypeList
                        title="Types"
                        counts={stats.types}
                        note="A card with several types (e.g. an Artifact Creature) is counted once in EACH of its types, so these totals can exceed the number of cards in the deck."
                    />
                    <DeckStatsTypeList
                        title="Subtypes"
                        counts={stats.subtypes}
                    />
                </div>
            </div>
        </GameDialog>
    );
}
