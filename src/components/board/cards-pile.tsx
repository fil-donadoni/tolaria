import { useMemo, useState } from "react";
import type { CardInstance } from "~/types/game";
import { getFanStyle, getFanWidth, fanCardClassName } from "~/lib/card-layout";
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
};

export default function CardsPile({
    cards,
    isFaceDown = false,
    emptyLabel,
    title,
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
                        width: `${getFanWidth(cards.length) + 32}px`,
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>
                            {title || "Cards"} ({cards.length})
                        </DialogTitle>
                    </DialogHeader>
                    <div className="overflow-x-auto overflow-y-visible py-4">
                        <div
                            className="flex items-end mx-auto"
                            style={{
                                width: `${getFanWidth(cards.length)}px`,
                            }}
                        >
                            {cards.map((cardInstance, cardIndex) => {
                                const style = getFanStyle(
                                    cardIndex,
                                    cards.length
                                );

                                return (
                                    <div
                                        key={cardInstance.id}
                                        className={fanCardClassName}
                                        style={style}
                                    >
                                        {isFaceDown ? (
                                            <CardBack />
                                        ) : (
                                            <CardImage
                                                card={cardInstance.card}
                                            />
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
