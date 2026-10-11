// One titled row of the home's Decks section ("Your decks" / "Presets",
// issue #5344): its count, then the tiles in a horizontal scroller — the row
// scrolls, the page never does.
import type { HomeDeckEntry } from "~/lib/lobbyHome";
import HomeDeckTile from "./home-deck-tile";

interface HomeDeckRowProps {
    title: string;
    entries: readonly HomeDeckEntry[];
    onOpen: (presetId: string) => void;
}

export default function HomeDeckRow({
    title,
    entries,
    onOpen,
}: HomeDeckRowProps) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {title} · {entries.length}
            </h3>
            <div className="flex gap-2 overflow-x-auto py-1">
                {entries.map((entry) => (
                    <HomeDeckTile
                        key={entry.deck.presetId}
                        entry={entry}
                        onOpen={onOpen}
                    />
                ))}
            </div>
        </div>
    );
}
