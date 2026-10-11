// One deck of the home's Decks section (PRD #5334 stories 10 and 13, issue
// #5344): art and name; under it the card a search matched, else the deck's
// Format. The tile's click OPENS the deck — the home browses, it never
// selects (selection lives in the setup flow).
import { FORMAT_LABELS } from "@convex/formats";
import type { HomeDeckEntry } from "~/lib/lobbyHome";
import FeaturedDeckArt from "./featured-deck-art";

interface HomeDeckTileProps {
    entry: HomeDeckEntry;
    onOpen: (presetId: string) => void;
}

export default function HomeDeckTile({ entry, onOpen }: HomeDeckTileProps) {
    const { deck, matchedCard } = entry;
    return (
        <button
            type="button"
            data-home-deck={deck.presetId}
            onClick={() => onOpen(deck.presetId)}
            className="w-36 shrink-0 overflow-hidden rounded-[var(--panel-radius)] border border-border-strong bg-surface text-left transition hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
            <span aria-hidden className="block">
                <FeaturedDeckArt
                    featuredCardId={deck.featuredCardId}
                    className="aspect-[16/10] w-full"
                />
            </span>
            <span className="block truncate px-2 pt-1.5 text-sm text-parchment">
                {deck.name}
            </span>
            <span className="block truncate px-2 pb-2 text-[11px] text-text-muted">
                {matchedCard ? (
                    <span className="text-accent">Contains {matchedCard}</span>
                ) : (
                    FORMAT_LABELS[deck.format]
                )}
                {!deck.isLegal && (
                    <span className="text-danger-strong"> · Illegal</span>
                )}
            </span>
        </button>
    );
}
