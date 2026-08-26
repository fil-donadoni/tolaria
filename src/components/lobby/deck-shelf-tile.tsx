import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import FeaturedDeckArt from "./featured-deck-art";
import DeckRowMenu from "./deck-row-menu";

interface DeckShelfTileProps {
    deck: LobbyDeck;
    selected: boolean;
    /** Make this deck the Loadout's active deck. Absent for a shelf that only
     *  browses (none today — stated as a prop so the affordance is explicit
     *  rather than implied by the presence of an `onSelect` closure). */
    onSelect: (presetId: string) => void;
    onOpen: (presetId: string) => void;
    /** Overflow actions. `undefined` when the viewer may not perform them (a
     *  non-admin over a preset shelf), which drops that ITEM from the "⋯" menu
     *  rather than rendering a dead row. The trigger itself always renders:
     *  `onOpen` is mandatory, and Open is the one action a shelf tile can never
     *  show inline (its own click is spent on selecting). */
    onEdit?: (presetId: string) => void;
    onDelete?: (presetId: string) => void;
}

/**
 * One Deck Shelf tile (ADR 0103 §6, issue #2726): art, name, a selected ring.
 *
 * The tile's own click SELECTS — that is the gesture acceptance criterion #3
 * names ("deck selection swaps the Loadout and the ambient"), and it is the
 * one a player repeats. Open / Edit / Delete move behind the "⋯" overflow, so
 * a shelf of twelve decks carries twelve controls rather than forty-eight.
 * Edit stays a visible single tap for the deck that matters most — the
 * SELECTED one — on the Loadout beside the shelf.
 *
 * Selection of an illegal deck stays blocked (ADR 0036, issue #512): the
 * server rejects a game started on one, so the tile is disabled and flagged
 * rather than allowed to fail at the mutation. Its overflow stays live — that
 * is how an illegal deck gets edited back into legality.
 */
export default function DeckShelfTile({
    deck,
    selected,
    onSelect,
    onOpen,
    onEdit,
    onDelete,
}: DeckShelfTileProps) {
    return (
        <div
            data-deck-tile
            data-selected={selected}
            className={cn(
                "relative w-32 shrink-0 overflow-hidden rounded-[var(--panel-radius)] border bg-surface transition",
                selected
                    ? "border-accent shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_16%,transparent)]"
                    : "border-[var(--hairline)] hover:border-[var(--hairline-strong)]"
            )}
        >
            <button
                type="button"
                // The ui-gate board walk's stable hook (`ensureBoard`,
                // `scripts/ui-gate/surfaces.ts`). It cannot address this by
                // text — the tile's visible text is the deck NAME — and the
                // accessible name below is deliberately not a literal either.
                // `:not([disabled])` over this attribute is what picks a tile
                // that can actually take the selection.
                data-deck-select
                onClick={() => onSelect(deck.presetId)}
                disabled={selected || !deck.isLegal}
                // An explicit name, not the content-derived one: the tile's
                // visible text is just the deck name, which says what it IS
                // and not what pressing it does. The visible label stays a
                // substring of the accessible name (WCAG 2.5.3).
                aria-label={
                    selected
                        ? `${deck.name} — already selected`
                        : `Select ${deck.name}`
                }
                title={
                    !deck.isLegal
                        ? "Deck is illegal for its format"
                        : selected
                          ? "Already selected"
                          : `Select ${deck.name}`
                }
                className="block w-full text-left disabled:cursor-default"
            >
                <FeaturedDeckArt
                    featuredCardId={deck.featuredCardId}
                    dim={!selected}
                    className="aspect-[16/10] w-full"
                />
                <span className="block truncate px-2 pb-2 pt-1.5 text-sm text-parchment">
                    {deck.name}
                </span>
            </button>

            {!deck.isLegal && (
                <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-sm bg-danger/25 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-strong">
                    Illegal
                </span>
            )}

            <div className="absolute right-0.5 top-0.5 z-10">
                <DeckRowMenu
                    deckName={deck.name}
                    onOpen={() => onOpen(deck.presetId)}
                    onEdit={onEdit ? () => onEdit(deck.presetId) : undefined}
                    onDelete={
                        onDelete ? () => onDelete(deck.presetId) : undefined
                    }
                />
            </div>
        </div>
    );
}
