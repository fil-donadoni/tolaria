import type { Doc } from "@convex/_generated/dataModel";
import DeckListItem from "./deck-list-item";

interface DeckListProps {
    decks: Doc<"decks">[];
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
                    key={deck._id}
                    deck={deck}
                    isSelected={deck.presetId === selectedPresetId}
                    onFocus={onFocus}
                />
            ))}
        </div>
    );
}
