import { useMemo, useState } from "react";
import type { CardInstance } from "~/types/game";
import GameDialog from "~/components/ui/game-dialog";
import CardBack from "../cards/card-back";
import SelectableCard from "../cards/selectable-card";
import CardImage from "../cards/card-image";

function seededRandom(seed: number) {
    const x = Math.sin(seed + 1) * 10000;
    return x - Math.floor(x);
}

type CardsPileProps = {
    cards: CardInstance[];
    isFaceDown?: boolean;
    emptyLabel?: string;
    title?: string;
    layout?: "fan" | "grid";
    onCardClick?: (card: CardInstance) => void;
    forceOpen?: boolean;
    /** Instance ids currently selected by the chooser. Selected cards get a
     *  distinct ring so multi-pick selections (e.g. a `search-library`
     *  choice) show per-card feedback instead of all-amber. */
    selectedIds?: string[];
    /** Rendered inside the expanded dialog below the cards. Used by the
     *  `search-library` picker to host its confirm button: the dialog opens
     *  as a modal (`forceOpen`) and would otherwise cover the board-level
     *  PendingChoicePrompt, leaving the chooser no reachable way to commit. */
    footer?: React.ReactNode;
};

/** Ring class for a selectable card: emerald once picked, amber otherwise. */
function selectionRing(isSelected: boolean): string {
    return isSelected
        ? "ring-2 ring-emerald-400 hover:ring-emerald-300"
        : "ring-2 ring-amber-400 hover:ring-amber-300";
}

function FanLayout({
    cards,
    isFaceDown,
    onCardClick,
    onClose,
    selectedIds,
}: {
    cards: CardInstance[];
    isFaceDown: boolean;
    onCardClick?: (card: CardInstance) => void;
    onClose: () => void;
    selectedIds?: string[];
}) {
    return (
        <div
            className="overflow-x-auto px-2 py-6"
            style={
                {
                    "--pile-card-w": "clamp(5.5rem, 14vw, 13rem)",
                } as React.CSSProperties
            }
        >
            <div
                className="flex mx-auto"
                style={{
                    width: `calc(var(--pile-card-w) * ${(cards.length + 1) / 2})`,
                    minWidth: "min-content",
                }}
            >
                {cards.map((cardInstance, cardIndex) => {
                    const inner = isFaceDown ? (
                        <CardBack />
                    ) : (
                        <CardImage card={cardInstance} />
                    );
                    const clickable = !isFaceDown && !!onCardClick;
                    const isSelected =
                        selectedIds?.includes(cardInstance.id) ?? false;
                    return (
                        <div
                            key={cardInstance.id}
                            className="w-(--pile-card-w) aspect-5/7 shrink-0"
                            style={{
                                marginLeft:
                                    cardIndex === 0
                                        ? "0"
                                        : "calc(var(--pile-card-w) * -0.5)",
                            }}
                        >
                            {clickable ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onCardClick(cardInstance);
                                        onClose();
                                    }}
                                    className={`w-full h-full bg-transparent border-0 p-0 cursor-pointer rounded ${selectionRing(isSelected)}`}
                                >
                                    {inner}
                                </button>
                            ) : (
                                inner
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function GridLayout({
    cards,
    isFaceDown,
    onCardClick,
    onClose,
    selectedIds,
}: {
    cards: CardInstance[];
    isFaceDown: boolean;
    onCardClick?: (card: CardInstance) => void;
    onClose: () => void;
    selectedIds?: string[];
}) {
    return (
        <div className="flex flex-wrap gap-2 justify-center py-4 px-2">
            {cards.map((cardInstance) => {
                const inner = isFaceDown ? (
                    <CardBack />
                ) : (
                    <CardImage card={cardInstance} />
                );
                const clickable = !isFaceDown && !!onCardClick;
                const isSelected =
                    selectedIds?.includes(cardInstance.id) ?? false;
                return (
                    <div
                        key={cardInstance.id}
                        className="w-24 sm:w-28 aspect-5/7 shrink-0"
                    >
                        {clickable ? (
                            <button
                                type="button"
                                onClick={() => {
                                    onCardClick(cardInstance);
                                    onClose();
                                }}
                                className={`w-full h-full bg-transparent border-0 p-0 cursor-pointer rounded ${selectionRing(isSelected)}`}
                            >
                                {inner}
                            </button>
                        ) : (
                            inner
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export default function CardsPile({
    cards,
    isFaceDown = false,
    emptyLabel,
    title,
    layout = "fan",
    onCardClick,
    forceOpen = false,
    selectedIds,
    footer,
}: CardsPileProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = forceOpen || internalOpen;
    const setIsOpen = (next: boolean) => {
        if (forceOpen) return;
        setInternalOpen(next);
    };

    const rotations = useMemo(
        () => cards.map((_, i) => seededRandom(i) * 4 - 2),
        [cards]
    );

    if (!cards.length) {
        return (
            <div className="w-(--card-w-sm) aspect-5/7 mb-2 flex justify-center items-center text-center p-2 border border-white/20 rounded-sm text-white/85 text-xs">
                {emptyLabel || "No cards"}
            </div>
        );
    }

    const pileCards = cards.map((cardInstance: CardInstance, cardIndex) => {
        const cardStyle = {
            transform: `rotate(${rotations[cardIndex]}deg)`,
        };

        const image = isFaceDown ? (
            <CardBack />
        ) : (
            <SelectableCard
                cardInstance={cardInstance}
                allowedActions={cardInstance.legalActions ?? []}
            />
        );

        return (
            <div
                key={cardIndex}
                className="absolute w-(--card-w-sm) aspect-5/7 mb-2"
                style={cardStyle}
            >
                {image}
            </div>
        );
    });

    const dialogTitle = `${title || "Cards"} (${cards.length})`;

    return (
        <>
            <div className="cursor-pointer" onClick={() => setIsOpen(true)}>
                {pileCards}
            </div>

            <GameDialog
                open={isOpen}
                onOpenChange={setIsOpen}
                title={dialogTitle}
                size="wide"
                dismissable={!forceOpen}
                showCloseButton={!forceOpen}
            >
                {layout === "fan" ? (
                    <FanLayout
                        cards={cards}
                        isFaceDown={isFaceDown}
                        onCardClick={onCardClick}
                        onClose={() => setIsOpen(false)}
                        selectedIds={selectedIds}
                    />
                ) : (
                    <GridLayout
                        cards={cards}
                        isFaceDown={isFaceDown}
                        onCardClick={onCardClick}
                        onClose={() => setIsOpen(false)}
                        selectedIds={selectedIds}
                    />
                )}
                {footer && (
                    <div className="sticky bottom-0 mt-2 flex justify-center border-t border-zinc-700/50 bg-[#0c0d12]/95 pt-3 pb-1">
                        {footer}
                    </div>
                )}
            </GameDialog>
        </>
    );
}
