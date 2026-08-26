import type { ReactNode } from "react";
import type { LobbyDeck } from "~/lib/deckTypes";
import DeckShelfTile from "./deck-shelf-tile";

interface DeckShelfProps {
    title: string;
    decks: LobbyDeck[];
    selectedPresetId: string | null;
    onSelect: (presetId: string) => void;
    onOpen: (presetId: string) => void;
    onEdit?: (presetId: string) => void;
    onDelete?: (presetId: string) => void;
    /** Controls that belong to the shelf as a whole — the Format filter and
     *  the "+ New deck" / "+ New preset" action. Passed in rather than
     *  hard-coded so the preset shelf can withhold the admin-only creator. */
    actions?: ReactNode;
    emptyLabel: string;
}

/**
 * A Deck Shelf (ADR 0103 §6, issue #2726): one horizontally-scrolling row of
 * art tiles with a selected ring, under a thin header carrying the shelf's own
 * controls.
 *
 * A ROW, not a list: the v3 lobby gave each deck a full-width row inside a
 * 28rem-capped vertical scroller, which is why two deck panels alone claimed
 * more than half of a 900px desktop viewport. A shelf spends one line of
 * height per collection regardless of how many decks are in it, which is what
 * makes Mode Tiles + Loadout + two shelves + a Limited footer fit one screen.
 *
 * `py-1` on the scroller is load-bearing, not spacing: the ui-gate probe flags
 * a scroll container whose client height is under 90% of its tallest child
 * (`scripts/ui-gate/probe.js`, `starved`), and a horizontal scrollbar eats
 * into exactly that. The padding keeps the port taller than the tiles it
 * holds on a platform that reserves scrollbar space.
 */
export default function DeckShelf({
    title,
    decks,
    selectedPresetId,
    onSelect,
    onOpen,
    onEdit,
    onDelete,
    actions,
    emptyLabel,
}: DeckShelfProps) {
    return (
        <section className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                    {title}
                </h2>
                {actions && (
                    <div className="flex items-center gap-2">{actions}</div>
                )}
            </div>
            {decks.length === 0 ? (
                <p className="rounded-sm border border-dashed border-[var(--hairline)] px-3 py-3 text-xs text-text-disabled">
                    {emptyLabel}
                </p>
            ) : (
                <div className="flex gap-2 overflow-x-auto py-1">
                    {decks.map((deck) => (
                        <DeckShelfTile
                            key={deck.presetId}
                            deck={deck}
                            selected={deck.presetId === selectedPresetId}
                            onSelect={onSelect}
                            onOpen={onOpen}
                            onEdit={onEdit}
                            onDelete={onDelete}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
