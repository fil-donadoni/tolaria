import { useMemo, useState } from "react";
import type { CardInstance } from "~/types/game";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
    /** When set, every card rendered inside the pile-expansion dialog is
     *  wrapped in a clickable button that invokes this handler. Used by
     *  graveyard target-selection (CR 109.2 / 400.7) so the chooser can pick
     *  a card from the dialog view of an opaque pile. */
    onCardClick?: (card: CardInstance) => void;
};

export default function CardsPile({
    cards,
    isFaceDown = false,
    emptyLabel,
    title,
    onCardClick,
}: CardsPileProps) {
    const [isOpen, setIsOpen] = useState(false);

    const rotations = useMemo(
        () => cards.map((_, i) => seededRandom(i) * 4 - 2),
        [cards]
    );

    if (!cards.length) {
        return (
            <div className="w-(--card-w-sm) aspect-5/7 mb-2 flex justify-center items-center text-center p-2 border border-white/20 rounded-sm text-white/40 text-xs">
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

    return (
        <>
            <div className="cursor-pointer" onClick={() => setIsOpen(true)}>
                {pileCards}
            </div>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent
                    className="px-4 max-w-[90vw]"
                    style={{
                        width: `calc(var(--card-w) * ${(cards.length + 1) / 2} + 2rem)`,
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {title || "Cards"} ({cards.length})
                        </DialogTitle>
                    </DialogHeader>
                    <div className="overflow-x-auto px-4 py-8">
                        <div
                            className="flex mx-auto"
                            style={{
                                width: `calc(var(--card-w) * ${(cards.length + 1) / 2})`,
                            }}
                        >
                            {cards.map((cardInstance, cardIndex) => {
                                const inner = isFaceDown ? (
                                    <CardBack />
                                ) : (
                                    <CardImage card={cardInstance} />
                                );
                                const clickable = !isFaceDown && !!onCardClick;
                                return (
                                    <div
                                        key={cardInstance.id}
                                        className="w-(--card-w) aspect-5/7 shrink-0"
                                        style={{
                                            marginLeft:
                                                cardIndex === 0
                                                    ? "0"
                                                    : "calc(var(--card-w) * -0.5)",
                                        }}
                                    >
                                        {clickable ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onCardClick(cardInstance);
                                                    setIsOpen(false);
                                                }}
                                                className="w-full h-full bg-transparent border-0 p-0 cursor-pointer ring-2 ring-amber-400 hover:ring-amber-300 rounded"
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
                </DialogContent>
            </Dialog>
        </>
    );
}
