import type { ReactNode } from "react";
import type { DeckPreset } from "@convex/deckPresets";
import DeckListItem from "./deck-list-item";

interface DeckListProps {
    decks: DeckPreset[];
    selectedPresetId: string | null;
    onFocus: (presetId: string) => void;
    onSelect?: (presetId: string) => void;
    title?: string;
    headerExtra?: ReactNode;
    emptyLabel?: string;
    renderActions?: (deck: DeckPreset) => ReactNode;
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
        <div className="flex w-full max-w-xl flex-col gap-2">
            {(title || headerExtra) && (
                <div className="flex items-center justify-between">
                    {title && (
                        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">
                            {title}
                        </h2>
                    )}
                    {headerExtra}
                </div>
            )}
            {decks.length === 0
                ? emptyLabel && (
                      <p className="rounded border border-dashed border-white/10 px-4 py-3 text-xs text-white/40">
                          {emptyLabel}
                      </p>
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
