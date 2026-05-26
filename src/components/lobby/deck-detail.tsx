import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import ManaSymbol from "../cards/mana-symbol";
import ActionButton from "../board/action-button";
import MoneyPileView from "./money-pile-view";

interface DeckDetailProps {
    deck: LobbyDeck;
    isSelected: boolean;
    onBack: () => void;
    onSelect: () => void;
}

export default function DeckDetail({
    deck,
    isSelected,
    onBack,
    onSelect,
}: DeckDetailProps) {
    return (
        <div className="flex h-screen w-full flex-col gap-4 p-6 text-text">
            <div className="flex items-center gap-4">
                <ActionButton
                    onClick={onBack}
                    label="← Back"
                    tone="secondary"
                />
                <div className="flex flex-1 flex-col">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold font-beleren text-parchment">
                            {deck.name}
                        </h1>
                        <div className="flex items-center gap-1 text-xl">
                            {deck.colors.map((c) => (
                                <ManaSymbol key={c} symbol={c} />
                            ))}
                        </div>
                        <span className="text-xs text-text-muted">
                            {deck.cards.length} cards · {deck.format}
                        </span>
                    </div>
                    {deck.description && (
                        <p className="text-sm text-text-muted">
                            {deck.description}
                        </p>
                    )}
                </div>
                <button
                    onClick={onSelect}
                    disabled={isSelected}
                    className={cn(
                        "rounded-sm px-4 py-2 text-sm font-semibold transition",
                        isSelected
                            ? "bg-accent-soft/30 text-accent"
                            : "bg-accent text-surface-base hover:bg-accent-strong"
                    )}
                >
                    {isSelected ? "Selected" : "Select this deck"}
                </button>
            </div>

            <div className="flex-1 overflow-auto">
                <MoneyPileView cards={deck.cards} />
            </div>
        </div>
    );
}
