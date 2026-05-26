import { useState } from "react";
import type { LobbyDeck } from "~/lib/deckTypes";
import { cn } from "~/lib/utils";
import ManaSymbol from "../cards/mana-symbol";
import ActionButton from "../board/action-button";
import GameDialog from "../ui/game-dialog";
import ManaPileView from "./mana-pile-view";

interface DeckDetailProps {
    deck: LobbyDeck;
    isSelected: boolean;
    onBack: () => void;
    onSelect: () => void;
    onDelete?: () => void;
}

export default function DeckDetail({
    deck,
    isSelected,
    onBack,
    onSelect,
    onDelete,
}: DeckDetailProps) {
    const [confirmDelete, setConfirmDelete] = useState(false);

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
                    <div className="flex items-center gap-2 md:ml-auto">
                        {onDelete && (
                            <ActionButton
                                onClick={() => setConfirmDelete(true)}
                                label="Delete"
                                tone="destructive"
                            />
                        )}
                        <button
                            onClick={onSelect}
                            disabled={isSelected}
                            className={cn(
                                "btn-base px-4 py-2 text-sm",
                                isSelected ? "btn-disabled" : "btn-tone-primary"
                            )}
                        >
                            {isSelected ? "Selected" : "Select this deck"}
                        </button>
                    </div>
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

            <GameDialog
                open={confirmDelete}
                onOpenChange={setConfirmDelete}
                title={`Delete "${deck.name}"?`}
                subtitle="This action cannot be undone."
            >
                <div className="flex justify-end gap-2 mt-4">
                    <ActionButton
                        onClick={() => setConfirmDelete(false)}
                        label="Cancel"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={() => {
                            setConfirmDelete(false);
                            onDelete?.();
                        }}
                        label="Delete"
                        tone="destructive"
                    />
                </div>
            </GameDialog>
        </div>
    );
}
