import type { ReactNode } from "react";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import ManaSymbol from "../cards/mana-symbol";

interface DeckListItemProps {
    deck: LobbyDeck;
    isSelected: boolean;
    onFocus: (presetId: string) => void;
    onSelect?: (presetId: string) => void;
    extraActions?: ReactNode;
}

export default function DeckListItem({
    deck,
    isSelected,
    onFocus,
    onSelect,
    extraActions,
}: DeckListItemProps) {
    const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onFocus(deck.presetId);
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={() => onFocus(deck.presetId)}
            onKeyDown={handleCardKeyDown}
            className={cn(
                "flex cursor-pointer items-center gap-4 rounded border px-4 py-3 text-left transition",
                isSelected
                    ? "border-white/60 bg-white/10"
                    : "border-white/20 bg-white/5 hover:bg-white/10"
            )}
        >
            <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-white">
                        {deck.name}
                    </span>
                    {isSelected && (
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                            Selected
                        </span>
                    )}
                </div>
                {deck.description && (
                    <span className="text-xs text-white/60">
                        {deck.description}
                    </span>
                )}
                <span className="text-[10px] uppercase tracking-wide text-white/40">
                    {deck.cards.length} cards · {deck.format}
                </span>
            </div>
            <div className="flex items-center gap-1 text-xl">
                {deck.colors.map((c) => (
                    <ManaSymbol key={c} symbol={c} />
                ))}
            </div>
            <span className="text-xs text-white/60">View →</span>
            {onSelect && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect(deck.presetId);
                    }}
                    disabled={isSelected}
                    className={cn(
                        "rounded px-3 py-2 text-xs font-semibold transition",
                        isSelected
                            ? "cursor-not-allowed bg-emerald-500/20 text-emerald-300"
                            : "bg-emerald-500/80 text-emerald-950 hover:bg-emerald-400"
                    )}
                    title={isSelected ? "Already selected" : "Select deck"}
                >
                    {isSelected ? "Selected" : "Select"}
                </button>
            )}
            {extraActions && (
                <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                >
                    {extraActions}
                </div>
            )}
        </div>
    );
}
