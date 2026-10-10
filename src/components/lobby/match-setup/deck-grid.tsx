// The setup flow's deck grid (PRD #5334 stories 29–37, issue #5341), shared
// by step 4 (your deck) and step 5 (the Bot's or second seat's deck): the
// decks the Match Format admits, searchable by deck or card name, grouped
// Your decks / Presets. Under Freeform a Format select narrows "every deck".
// Step 5 passes `mirror`, an always-admitted choice above the grid.
import { useState } from "react";
import { FORMAT_LABELS, type FormatId } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import {
    deckGrid,
    freeformFormatOptions,
    type DeckGridFormat,
} from "~/lib/matchSetupDeckGrid";
import DeckGridSection from "./deck-grid-section";
import SetupChoice from "./setup-choice";

export default function DeckGrid({
    decks,
    matchFormat,
    selectedId,
    onSelect,
    mirror,
}: {
    decks: readonly LobbyDeck[];
    matchFormat: FormatId;
    /** The selected deck's id; `null` when none is (or Mirror is). */
    selectedId: string | null;
    onSelect: (presetId: string) => void;
    mirror?: { selected: boolean; onSelect: () => void };
}) {
    const [query, setQuery] = useState("");
    const [chosenFormat, setFormat] = useState<DeckGridFormat>("all");
    const freeform = matchFormat === "freeform";
    const formatOptions = freeformFormatOptions(decks);
    // A Format whose last deck went away falls back to every Format rather
    // than leaving the select on an option it no longer lists.
    const format =
        chosenFormat !== "all" && formatOptions.includes(chosenFormat)
            ? chosenFormat
            : "all";
    const admitted = deckGrid(decks, matchFormat, "");
    const empty = admitted.mine.length + admitted.presets.length === 0;
    const grid = deckGrid(decks, matchFormat, query, format);
    const shown = grid.mine.length + grid.presets.length;

    return (
        <div className="flex flex-col gap-3">
            {mirror && (
                <div data-mirror-choice className="flex">
                    <SetupChoice
                        title="Mirror"
                        hint="Plays your deck — always admitted"
                        selected={mirror.selected}
                        onSelect={mirror.onSelect}
                    />
                </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                {freeform && (
                    <select
                        aria-label="Deck Format"
                        value={format}
                        onChange={(e) =>
                            setFormat(e.target.value as DeckGridFormat)
                        }
                        className="input-field px-2 py-1.5 text-sm"
                    >
                        <option value="all">All Formats</option>
                        {formatOptions.map((f) => (
                            <option key={f} value={f}>
                                {FORMAT_LABELS[f]}
                            </option>
                        ))}
                    </select>
                )}
                <input
                    type="search"
                    aria-label="Search decks"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search deck or card name"
                    className="input-field min-w-0 flex-1 px-3 py-1.5 text-sm"
                />
            </div>
            <DeckGridSection
                title="Your decks"
                entries={grid.mine}
                selectedId={selectedId}
                showFormat={freeform}
                onSelect={onSelect}
            />
            <DeckGridSection
                title="Presets"
                entries={grid.presets}
                selectedId={selectedId}
                showFormat={freeform}
                onSelect={onSelect}
            />
            {shown === 0 && (
                <p className="rounded-sm border border-dashed border-[var(--hairline)] px-3 py-3 text-sm text-text-muted">
                    {empty
                        ? `No ${FORMAT_LABELS[matchFormat]} deck yet. Import one, ${mirror ? "play the Mirror, " : ""}or change the Match Format.`
                        : "No deck matches this search."}
                </p>
            )}
        </div>
    );
}
