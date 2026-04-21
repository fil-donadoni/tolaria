import type { DeckPreset } from "@convex/deckPresets";
import { cn } from "~/lib/utils";
import MoneyPileView from "./money-pile-view";

interface DeckDetailProps {
    deck: DeckPreset;
    isSelected: boolean;
    onBack: () => void;
    onSelect: () => void;
}

const COLOR_CLASSES: Record<string, string> = {
    W: "bg-yellow-100 text-yellow-900",
    U: "bg-blue-400 text-blue-950",
    B: "bg-neutral-800 text-white",
    R: "bg-red-500 text-red-950",
    G: "bg-green-500 text-green-950",
    C: "bg-gray-400 text-gray-900",
};

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
                        <div className="flex items-center gap-1">
                            {deck.colors.map((c) => (
                                <span
                                    key={c}
                                    className={cn(
                                        "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                                        COLOR_CLASSES[c] ??
                                            "bg-white/20 text-white"
                                    )}
                                >
                                    {c}
                                </span>
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
