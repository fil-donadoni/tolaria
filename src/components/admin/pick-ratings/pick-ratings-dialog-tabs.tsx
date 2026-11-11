import SegmentedControl from "~/components/ui/segmented-control";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { topOfPackChance } from "./pick-ratings-ladder-model";

export type DialogTab = "ladder" | "pack";

const TABS = [
    { value: "ladder", label: "Ladder" },
    { value: "pack", label: "Pack test" },
] as const;

interface PickRatingsDialogTabsProps {
    tab: DialogTab;
    onTab: (tab: DialogTab) => void;
    card: ScopeCardRating;
    all: readonly ScopeCardRating[];
}

/** The Ladder / Pack test switch, with "Top of a random pack %" beside it so
 *  it stays visible on both tabs. */
export default function PickRatingsDialogTabs({
    tab,
    onTab,
    card,
    all,
}: PickRatingsDialogTabsProps) {
    return (
        <div className="flex items-center gap-2 border-b border-border-subtle/30 pb-2">
            <SegmentedControl
                ariaLabel="Dialog view"
                options={TABS}
                value={tab}
                onChange={onTab}
            />
            <span className="text-xs text-text-muted">p switches</span>
            <span
                className="ml-auto text-xs text-text-muted"
                title="Share of random 15-card packs of this scope with no higher-rated card, ties counted as top."
            >
                Top of a random pack{" "}
                <span className="font-mono text-text" data-pick-rating-top>
                    {Math.round(topOfPackChance(all, card) * 100)}%
                </span>
            </span>
        </div>
    );
}
