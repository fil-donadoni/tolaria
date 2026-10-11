// The home's Decks section (PRD #5334 stories 10–14, issue #5344): every
// deck the player owns and every preset, narrowed by a Format select placed
// BEFORE a deck-or-card search (stacked on a phone), and "+ New Deck".
import { useState } from "react";
import type { LobbyDeck } from "~/lib/deckTypes";
import { homeDecks, type HomeDeckEntry } from "~/lib/lobbyHome";
import {
    getStoredDeckFormatFilter,
    storeDeckFormatFilter,
    type DeckFormatFilter as DeckFormatFilterValue,
} from "~/lib/session";
import { Button } from "~/components/ui/button";
import DeckFormatFilter from "./deck-format-filter";
import HomeDeckRow from "./home-deck-row";

interface HomeDecksSectionProps {
    decks: readonly LobbyDeck[];
    onOpen: (presetId: string) => void;
    /** Opens the builder, seeded with the selected Format (none for All). */
    onNew: (format: DeckFormatFilterValue) => void;
}

export default function HomeDecksSection({
    decks,
    onOpen,
    onNew,
}: HomeDecksSectionProps) {
    // Persisted so the choice survives a reload (#513).
    const [format, setFormat] = useState<DeckFormatFilterValue>(() =>
        getStoredDeckFormatFilter()
    );
    const [query, setQuery] = useState("");
    const { mine, presets } = homeDecks(decks, format, query);
    const groups: [string, HomeDeckEntry[]][] = [
        ["Your decks", mine],
        ["Presets", presets],
    ];
    return (
        <section
            data-home-section="decks"
            aria-labelledby="home-decks-heading"
            className="flex flex-col gap-3"
        >
            <div className="flex items-center justify-between">
                <h2
                    id="home-decks-heading"
                    className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted"
                >
                    Decks
                </h2>
                <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onNew(format)}
                >
                    + New Deck
                </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <DeckFormatFilter
                    value={format}
                    onChange={(next) => {
                        setFormat(next);
                        storeDeckFormatFilter(next);
                    }}
                />
                <input
                    type="search"
                    aria-label="Search decks or cards"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search deck or card name…"
                    className="input-field min-w-0 flex-1 px-3 py-1.5 text-sm"
                />
            </div>
            {mine.length === 0 && presets.length === 0 ? (
                <p className="text-xs text-text-disabled">No decks match.</p>
            ) : (
                groups.map(([title, entries]) =>
                    entries.length === 0 ? null : (
                        <HomeDeckRow
                            key={title}
                            title={title}
                            entries={entries}
                            onOpen={onOpen}
                        />
                    )
                )
            )}
        </section>
    );
}
