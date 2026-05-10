import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import ManaSymbol from "../cards/mana-symbol";
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
        <div className="flex h-screen w-full flex-col gap-4 p-6 text-white">
            <div className="flex items-center gap-4">
                <button
                    onClick={onBack}
                    className="rounded border border-white/20 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
                >
                    ← Back
                </button>
                <div className="flex flex-1 flex-col">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold">{deck.name}</h1>
                        <div className="flex items-center gap-1 text-xl">
                            {deck.colors.map((c) => (
                                <ManaSymbol key={c} symbol={c} />
                            ))}
                        </div>
                        <span className="text-xs text-white/50">
                            {deck.cards.length} cards · {deck.format}
                        </span>
                    </div>
                    {deck.description && (
                        <p className="text-sm text-white/60">
                            {deck.description}
                        </p>
                    )}
                </div>
                <button
                    onClick={onSelect}
                    disabled={isSelected}
                    className={cn(
                        "rounded px-4 py-2 text-sm font-semibold transition",
                        isSelected
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-emerald-500/80 text-emerald-950 hover:bg-emerald-400"
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
