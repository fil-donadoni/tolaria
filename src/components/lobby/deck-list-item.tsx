import type { ReactNode } from "react";
import { FORMAT_RULES } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import ManaSymbol from "../cards/mana-symbol";
import FeaturedDeckArt from "./featured-deck-art";

interface DeckListItemProps {
    deck: LobbyDeck;
    isSelected: boolean;
    onFocus: (presetId: string) => void;
    onSelect?: (presetId: string) => void;
    extraActions?: ReactNode;
}

export default function DeckListItem({
    deck,
    isSelected,
    onFocus,
    onSelect,
    extraActions,
}: DeckListItemProps) {
    const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onFocus(deck.presetId);
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onFocus(deck.presetId)}
            onKeyDown={handleCardKeyDown}
            // Micro-motion (#598): `data-deck-row` + `data-selected` drive the
            // selected-Deck pulse, `deck-row-liftable` the hover-lift. Both are
            // gated behind prefers-reduced-motion: no-preference in index.css,
            // so neither runs when reduced motion is requested.
            data-deck-row
            data-selected={isSelected}
            className={cn(
                "deck-row-liftable group flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5 text-left transition",
                isSelected
                    ? "border-accent/60 bg-accent-soft/30"
                    : "border-border-subtle bg-surface-elevated hover:border-border-accent/60"
            )}
        >
            {/* Featured card-art thumbnail (PRD #589, issue #600) — resolved
                Featured Card ID → art_crop, with a graceful fallback for decks
                with no resolvable art. */}
            <FeaturedDeckArt
                featuredCardId={deck.featuredCardId}
                dim
                className="h-12 w-12 shrink-0 rounded ring-1 ring-black/40"
            />

            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                    <span className="truncate font-beleren text-sm tracking-wide text-parchment">
                        {deck.name}
                    </span>
                    <div className="flex shrink-0 items-center gap-0.5 text-base">
                        {deck.colors.map((c) => (
                            <ManaSymbol key={c} symbol={c} className="size-4" />
                        ))}
                    </div>
                    {isSelected && (
                        <span className="rounded-sm bg-accent-soft/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                            Selected
                        </span>
                    )}
                    {/* Derived legality (ADR 0036, issue #512): an illegal deck
                        is flagged here and blocked from selection below. */}
                    {!deck.isLegal && (
                        <span
                            className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger"
                            title={deck.reasons.map((r) => r.message).join(" ")}
                        >
                            Illegal
                        </span>
                    )}
                </div>
                {deck.description && (
                    <span className="truncate text-xs text-text-muted">
                        {deck.description}
                    </span>
                )}
                <span className="text-[10px] uppercase tracking-wide text-text-disabled">
                    {deck.cards.length} cards ·{" "}
                    {FORMAT_RULES[deck.format].label}
                </span>
            </div>

            <div
                className="flex shrink-0 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
            >
                {onSelect && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect(deck.presetId);
                        }}
                        disabled={isSelected || !deck.isLegal}
                        className={cn(
                            "btn-base px-3 py-2 text-xs",
                            isSelected || !deck.isLegal
                                ? "btn-disabled"
                                : "btn-tone-primary"
                        )}
                        title={
                            !deck.isLegal
                                ? "Deck is illegal for its format"
                                : isSelected
                                  ? "Already selected"
                                  : "Select deck"
                        }
                    >
                        {isSelected ? "Selected" : "Select"}
                    </button>
                )}
                {extraActions}
            </div>
        </div>
    );
}
