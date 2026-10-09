// PROTOTYPE — throwaway. The deck picker every variant shares: the lobby's
// own DeckShelfTile (featured art + name) in a wrapping grid, pre-filtered by
// Match Format admission, searchable by deck OR card name.

import { useMemo, useState } from "react";
import type { FormatId } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import DeckShelfTile from "../deck-shelf-tile";
import {
    deckAdmitted,
    deckMatchesQuery,
    formatLabel,
    matchedCardName,
    ARENA_MATCH_FORMATS,
} from "./match-setup-logic";

interface ProtoDeckGridProps {
    decks: LobbyDeck[];
    matchFormat: FormatId;
    selectedId: string | null;
    onSelect: (presetId: string) => void;
    onImport: () => void;
    /** Opponent-deck step only: the always-valid Mirror tile. */
    mirror?: { selected: boolean; onSelect: () => void };
    compact?: boolean;
}

export default function ProtoDeckGrid({
    decks,
    matchFormat,
    selectedId,
    onSelect,
    onImport,
    mirror,
    compact = false,
}: ProtoDeckGridProps) {
    const [query, setQuery] = useState("");
    const [formatFilter, setFormatFilter] = useState<FormatId | "all">("all");
    const isFreeform = matchFormat === "freeform";

    const visible = useMemo(
        () =>
            decks
                .filter((d) => deckAdmitted(d, matchFormat))
                .filter(
                    (d) =>
                        !isFreeform ||
                        formatFilter === "all" ||
                        d.format === formatFilter
                )
                .filter((d) => deckMatchesQuery(d, query)),
        [decks, matchFormat, isFreeform, formatFilter, query]
    );
    const mine = visible.filter((d) => d.kind === "user");
    const presets = visible.filter((d) => d.kind === "preset");

    const section = (title: string, list: LobbyDeck[]) =>
        list.length > 0 && (
            <div className="flex flex-col gap-1.5">
                <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    {title} · {list.length}
                </h4>
                <div className="flex flex-wrap gap-2">
                    {list.map((d) => (
                        <div key={d.presetId} className="flex flex-col">
                            <DeckShelfTile
                                deck={d}
                                selected={d.presetId === selectedId}
                                onSelect={onSelect}
                                onOpen={() => {}}
                            />
                            {matchedCardName(d, query) && (
                                <span className="w-32 truncate px-1 text-[10px] text-accent">
                                    ∋ {matchedCardName(d, query)}
                                </span>
                            )}
                            {isFreeform && (
                                <span className="w-32 truncate px-1 text-[10px] text-text-disabled">
                                    {formatLabel(d.format)}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search deck or card name… (e.g. solitary)"
                    className="min-w-0 flex-1 rounded-sm border border-border-strong bg-surface/70 px-3 py-1.5 text-sm text-text placeholder:text-text-disabled"
                />
                {isFreeform && (
                    <select
                        aria-label="Deck format"
                        value={formatFilter}
                        onChange={(e) =>
                            setFormatFilter(e.target.value as FormatId | "all")
                        }
                        className="rounded-sm border border-border-strong bg-surface/70 px-2 py-1.5 text-sm text-text"
                    >
                        <option value="all">All formats</option>
                        {[...ARENA_MATCH_FORMATS, "limited" as FormatId].map(
                            (f) => (
                                <option key={f} value={f}>
                                    {formatLabel(f)}
                                </option>
                            )
                        )}
                    </select>
                )}
                <button
                    type="button"
                    onClick={onImport}
                    className="rounded-sm border border-border-strong px-3 py-1.5 text-sm text-text hover:border-accent/60"
                >
                    ⇣ Import deck
                </button>
            </div>

            <div
                className={cn(
                    "flex flex-col gap-3 overflow-y-auto pr-1",
                    compact ? "max-h-[22rem]" : "max-h-[30rem]"
                )}
            >
                {mirror && (
                    <button
                        type="button"
                        onClick={mirror.onSelect}
                        className={cn(
                            "flex w-full items-center gap-3 rounded-[var(--panel-radius)] border px-3 py-2 text-left text-sm",
                            mirror.selected
                                ? "border-accent text-text"
                                : "border-border-strong text-text-muted hover:border-accent/60"
                        )}
                    >
                        <span className="text-lg">⇄</span>
                        <span>
                            <span className="block font-medium text-parchment">
                                Mirror
                            </span>
                            <span className="text-xs">
                                Same list as your deck — always valid
                            </span>
                        </span>
                    </button>
                )}
                {section("Your decks", mine)}
                {section("Presets", presets)}
                {visible.length === 0 && (
                    <p className="rounded-sm border border-dashed border-[var(--hairline)] px-3 py-3 text-xs text-text-disabled">
                        No {formatLabel(matchFormat)} deck matches. Import one,
                        or change the Match Format.
                    </p>
                )}
            </div>
        </div>
    );
}
