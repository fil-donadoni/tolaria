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
                "flex flex-col cursor-pointer gap-3 rounded-sm border px-4 py-3 text-left transition",
                isSelected
                    ? "border-accent/40 bg-accent-soft/20"
                    : "border-border-subtle/40 bg-surface-elevated/20 hover:bg-surface-elevated/40"
            )}
        >
            <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-parchment">
                    {deck.name}
                </span>
                {isSelected && (
                    <span className="rounded-sm bg-accent-soft/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        Selected
                    </span>
                )}
            </div>

            <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-1 text-xl">
                        {deck.colors.map((c) => (
                            <ManaSymbol key={c} symbol={c} />
                        ))}
                    </div>
                    {deck.description && (
                        <span className="text-xs text-text-muted">
                            {deck.description}
                        </span>
                    )}
                    <span className="text-[10px] uppercase tracking-wide text-text-disabled">
                        {deck.cards.length} cards · {deck.format}
                    </span>
                </div>

                <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                >
                    <span className="text-xs text-text-muted">View</span>
                    {onSelect && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect(deck.presetId);
                            }}
                            disabled={isSelected}
                            className={cn(
                                "btn-base px-3 py-2 text-xs",
                                isSelected ? "btn-disabled" : "btn-tone-primary"
                            )}
                            title={
                                isSelected
                                    ? "Already selected"
                                    : "Select deck"
                            }
                        >
                            {isSelected ? "Selected" : "Select"}
                        </button>
                    )}
                    {extraActions}
                </div>
            </div>
        </div>
    );
}
