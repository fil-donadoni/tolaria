// One group of the setup flow's deck grid (PRD #5334 story 31, issue #5341):
// "Your decks" or "Presets", with its count. Renders nothing when empty.
import { useId } from "react";
import type { DeckGridEntry } from "~/lib/matchSetupDeckGrid";
import DeckGridCell from "./deck-grid-cell";

export default function DeckGridSection({
    title,
    entries,
    selectedId,
    showFormat,
    onSelect,
}: {
    title: string;
    entries: readonly DeckGridEntry[];
    selectedId: string | null;
    showFormat: boolean;
    onSelect: (presetId: string) => void;
}) {
    const headingId = useId();
    if (entries.length === 0) return null;
    return (
        <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
            <h3
                id={headingId}
                className="text-[11px] font-semibold tracking-wide text-text-muted uppercase"
            >
                {title} · {entries.length}
            </h3>
            <div className="flex flex-wrap gap-2">
                {entries.map((entry) => (
                    <DeckGridCell
                        key={entry.deck.presetId}
                        entry={entry}
                        selected={entry.deck.presetId === selectedId}
                        showFormat={showFormat}
                        onSelect={onSelect}
                    />
                ))}
            </div>
        </section>
    );
}
