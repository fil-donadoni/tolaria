import type { ReactNode } from "react";
import type { LobbyDeck } from "~/lib/deckTypes";
import EmptyState from "~/components/ui/empty-state";
import DeckListItem from "./deck-list-item";

interface DeckListProps {
    decks: LobbyDeck[];
    selectedPresetId: string | null;
    onFocus: (presetId: string) => void;
    onSelect?: (presetId: string) => void;
    title?: string;
    headerExtra?: ReactNode;
    emptyLabel?: string;
    renderActions?: (deck: LobbyDeck) => ReactNode;
}

export default function DeckList({
    decks,
    selectedPresetId,
    onFocus,
    onSelect,
    title,
    headerExtra,
    emptyLabel,
    renderActions,
}: DeckListProps) {
    return (
        <div className="flex w-full flex-col gap-2">
            {(title || headerExtra) && (
                <div className="flex items-center justify-between">
                    {title && (
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                            {title}
                        </h2>
                    )}
                    {headerExtra}
                </div>
            )}
            {decks.length === 0
                ? emptyLabel && (
                      <EmptyState
                          message={emptyLabel}
                          className="rounded-sm border border-dashed border-border-subtle/30 px-4 py-3 text-xs text-text-disabled"
                      />
                  )
                : decks.map((deck) => (
                      <DeckListItem
                          key={deck.presetId}
                          deck={deck}
                          isSelected={deck.presetId === selectedPresetId}
                          onFocus={onFocus}
                          onSelect={onSelect}
                          extraActions={renderActions?.(deck)}
                      />
                  ))}
        </div>
    );
}
