import type { ReactNode } from "react";
import { FORMAT_RULES } from "@convex/formats";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
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
    // The overlay button borrows the visible deck name as its accessible name
    // (`aria-labelledby`) rather than duplicating it into an `aria-label`,
    // which is what would make a screen reader read the deck twice.
    const nameId = `deck-name-${deck.presetId}`;

    return (
        // OVERLAY BUTTON, NOT A ROLE=BUTTON WRAPPER (issue #2593).
        //
        // This row used to be `<div role="button" tabIndex={0}>` around a real
        // `<button>` (Select) plus `extraActions` — axe `nested-interactive`,
        // serious, 52 nodes on the lobby at every one of the five viewports,
        // and the reason the lobby budget carried a non-zero `axeSerious`
        // floor. An interactive role may not contain focusable descendants:
        // assistive tech flattens the row to one control and the buttons
        // inside it become unreachable.
        //
        // The remedy is the standard card-with-actions pattern: the row is an
        // inert container (`relative`), and the row-wide gesture belongs to ONE
        // real `<button>` absolutely positioned over the whole row, named by
        // the deck-name text through `aria-labelledby`. A pointer anywhere on
        // the row therefore activates a genuine button — the same code path
        // Enter and Space take, so there is no second keyboard implementation
        // to keep in sync. The actions cluster sits at `z-10`, above it, so
        // Select and `extraActions` keep their own hit areas (they still stop
        // propagation, cheaply, so a future layout change cannot double-fire).
        //
        // The overlay is a SEPARATE element rather than an `::after` stretched
        // from the name button, which is what the first cut of this did:
        // measured at 390x844x3, the name is a `truncate` flex item that
        // squeezes to sub-4px on a phone, and a control that measures 4px wide
        // is a control nobody can hit — `ctrlsZero 52` on the lobby, over a
        // budget floor of 0. Sizing the hit area from the ROW instead of from
        // the label makes it independent of how hard the label is squeezed.
        <div
            // Micro-motion (#598): `data-deck-row` + `data-selected` drive the
            // selected-Deck pulse, `deck-row-liftable` the hover-lift. Both are
            // gated behind prefers-reduced-motion: no-preference in index.css,
            // so neither runs when reduced motion is requested.
            data-deck-row
            data-selected={isSelected}
            className={cn(
                "deck-row-liftable group relative flex items-center gap-3 rounded-sm border px-3 py-2.5 text-left",
                isSelected
                    ? "border-accent/60 bg-accent-soft/30"
                    : "border-border-subtle bg-surface-elevated hover:border-border-accent/60"
            )}
        >
            {/* The row-wide hit area. Positioned, so it paints above the
                non-positioned row content below it and a click anywhere that
                is not an action button lands here. */}
            <button
                type="button"
                onClick={() => onFocus(deck.presetId)}
                aria-labelledby={nameId}
                className="absolute inset-0 rounded-sm"
            />

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
                    <span
                        id={nameId}
                        className="truncate font-beleren text-sm tracking-wide text-parchment"
                    >
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
                            className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-strong-strong"
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
                className="relative z-10 flex shrink-0 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
            >
                {onSelect && (
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={(e) => {
                            e.stopPropagation();
                            onSelect(deck.presetId);
                        }}
                        disabled={isSelected || !deck.isLegal}
                        title={
                            !deck.isLegal
                                ? "Deck is illegal for its format"
                                : isSelected
                                  ? "Already selected"
                                  : "Select deck"
                        }
                    >
                        {isSelected ? "Selected" : "Select"}
                    </Button>
                )}
                {extraActions}
            </div>
        </div>
    );
}
