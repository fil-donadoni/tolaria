import type { DeckPreset } from "@convex/deckPresets";
import DeckListItem from "./deck-list-item";

interface DeckListProps {
    decks: DeckPreset[];
    selectedPresetId: string | null;
    onFocus: (presetId: string) => void;
}

export default function DeckList({
    decks,
    selectedPresetId,
    onFocus,
}: DeckListProps) {
    return (
        <div className="flex w-full max-w-xl flex-col gap-2">
            {decks.map((deck) => (
                <DeckListItem
                    key={deck.presetId}
                    deck={deck}
                    isSelected={deck.presetId === selectedPresetId}
                    onFocus={onFocus}
                />
            ))}
        </div>
    );
}
