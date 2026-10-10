// One deck of the setup flow's grid (PRD #5334 stories 30, 33–34, issue
// #5341): the lobby's own deck tile, and under it what the grid knows that the
// tile does not — the card a search matched, the deck's Format under
// Freeform, and why an illegal deck cannot be picked.
import { FORMAT_LABELS } from "@convex/formats";
import type { DeckGridEntry } from "~/lib/matchSetupDeckGrid";
import DeckShelfTile from "../deck-shelf-tile";

export default function DeckGridCell({
    entry,
    selected,
    showFormat,
    onSelect,
}: {
    entry: DeckGridEntry;
    selected: boolean;
    showFormat: boolean;
    onSelect: (presetId: string) => void;
}) {
    const { deck, matchedCard, selectable } = entry;
    return (
        <div data-grid-deck={deck.presetId} className="flex w-32 flex-col">
            <DeckShelfTile
                deck={deck}
                selected={selected}
                onSelect={onSelect}
            />
            {matchedCard && (
                <span className="truncate px-1 text-[11px] text-accent">
                    Contains {matchedCard}
                </span>
            )}
            {showFormat && (
                <span className="truncate px-1 text-[11px] text-text-muted">
                    {FORMAT_LABELS[deck.format]}
                </span>
            )}
            {!selectable && (
                <span className="line-clamp-2 px-1 text-[11px] text-danger-strong">
                    {deck.reasons[0]?.message ?? "Illegal for its Format"}
                </span>
            )}
        </div>
    );
}
