// PROTOTYPE — throwaway. The Decks section: the lobby's own Deck Shelves
// (art + name), browse-only here — a click opens the deck.
import { useState } from "react";
import type { FormatId } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import FeaturedDeckArt from "../featured-deck-art";
import { ARENA_MATCH_FORMATS, deckMatchesQuery, formatLabel, matchedCardName } from "./match-setup-logic";

export default function ProtoDecksSection({
    userDecks,
    presetDecks,
    onOpen,
    onNew,
    layout = "rows",
}: {
    userDecks: LobbyDeck[];
    presetDecks: LobbyDeck[];
    onOpen: (presetId: string) => void;
    onNew: () => void;
    layout?: "rows" | "grid";
}) {
    const [query, setQuery] = useState("");
    const [format, setFormat] = useState<FormatId | "all">("all");
    const keep = (d: LobbyDeck) =>
        (format === "all" || d.format === format) && deckMatchesQuery(d, query);
    const group = (title: string, all: LobbyDeck[]) => {
        const decks = all.filter(keep);
        return decks.length === 0 ? null : (
        <div className="flex flex-col gap-1.5">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                {title} · {decks.length}
            </h3>
            <div
                className={cn(
                    "gap-2",
                    layout === "rows"
                        ? "flex overflow-x-auto py-1"
                        : "grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))]"
                )}
            >
                {decks.map((d) => (
                    <button
                        key={d.presetId}
                        type="button"
                        onClick={() => onOpen(d.presetId)}
                        className="w-36 shrink-0 overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface text-left hover:border-accent/60 data-[grid]:w-auto"
                        data-grid={layout === "grid" || undefined}
                    >
                        <FeaturedDeckArt
                            featuredCardId={d.featuredCardId}
                            className="aspect-[16/10] w-full"
                        />
                        <span className="block truncate px-2 pt-1.5 text-sm text-parchment">
                            {d.name}
                        </span>
                        <span className="block truncate px-2 pb-2 text-[10px] uppercase tracking-wide text-text-muted">
                            {matchedCardName(d, query)
                                ? `∋ ${matchedCardName(d, query)}`
                                : formatLabel(d.format)}
                            {!d.isLegal && " · illegal"}
                        </span>
                    </button>
                ))}
            </div>
        </div>
        );
    };
    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    Decks
                </h2>
                <button
                    type="button"
                    onClick={onNew}
                    className="rounded-sm bg-parchment px-3 py-1 text-xs font-semibold text-surface-base"
                >
                    + New Deck
                </button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
                <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search deck or card name… (e.g. solitary)"
                    className="min-w-0 flex-1 rounded-sm border border-border-strong bg-surface/70 px-3 py-1.5 text-sm text-text placeholder:text-text-disabled"
                />
                <select
                    aria-label="Deck format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as FormatId | "all")}
                    className="rounded-sm border border-border-strong bg-surface/70 px-2 py-1.5 text-sm text-text"
                >
                    <option value="all">All formats</option>
                    {[...ARENA_MATCH_FORMATS, "limited" as FormatId, "manual" as FormatId].map((f) => (
                        <option key={f} value={f}>
                            {formatLabel(f)}
                        </option>
                    ))}
                </select>
            </div>
            {group("Your decks", userDecks)}
            {group("Presets", presetDecks)}
        </section>
    );
}
