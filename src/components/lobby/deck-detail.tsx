import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import ManaSymbol from "../cards/mana-symbol";
import ActionButton from "../board/action-button";
import ManaPileView from "./mana-pile-view";

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
        <div className="flex w-full flex-col gap-4 p-6 text-text">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                <div className="flex items-center gap-3">
                    <ActionButton
                        onClick={onBack}
                        label="← Back"
                        tone="ghost"
                    />
                    <h1 className="text-xl font-bold font-beleren text-parchment">
                        {deck.name}
                    </h1>
                    <div className="flex items-center gap-1 text-xl">
                        {deck.colors.map((c) => (
                            <ManaSymbol key={c} symbol={c} />
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:flex-1">
                    <span className="text-xs text-text-muted">
                        {deck.cards.length} cards · {deck.format}
                    </span>
                    {deck.description && (
                        <p className="text-sm text-text-muted">
                            {deck.description}
                        </p>
                    )}
                    <button
                        onClick={onSelect}
                        disabled={isSelected}
                        className={cn(
                            "font-beleren tracking-wide px-4 py-2 rounded-sm text-sm border transition-colors shadow-md md:ml-auto",
                            isSelected
                                ? "bg-surface/40 border-border-subtle/40 text-text-disabled cursor-not-allowed"
                                : "bg-accent-soft/30 border-accent/45 text-accent-strong hover:bg-accent-soft/50 active:bg-accent-soft/65 cursor-pointer"
                        )}
                    >
                        {isSelected ? "Selected" : "Select this deck"}
                    </button>
                </div>
            </div>

            <div
                style={
                    {
                        "--card-w": "min(8rem, 20vw, 19vh)",
                        "--card-h": "calc(min(8rem, 20vw, 19vh) * 7 / 5)",
                    } as React.CSSProperties
                }
            >
                <ManaPileView cards={deck.cards} />
            </div>
        </div>
    );
}
