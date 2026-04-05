import { useMemo } from "react";
import type { CardInstance } from "~/types/game";
import CardBack from "../cards/card-back";
import SelectableCard from "../cards/selectable-card";

function seededRandom(seed: number) {
    const x = Math.sin(seed + 1) * 10000;
    return x - Math.floor(x);
}

type CardsPileProps = {
    cards: CardInstance[];
    isFaceDown?: boolean;
    emptyLabel?: string;
};

export default function CardsPile({
    cards,
    isFaceDown = false,
    emptyLabel,
}: CardsPileProps) {
    const rotations = useMemo(
        () => cards.map((_, i) => seededRandom(i) * 4 - 2),
        [cards]
    );
    if (!cards.length) {
        return (
            <div className="w-24 aspect-5/7 mb-2 flex justify-center items-center text-center p-2 border border-white/20 rounded-md">
                {emptyLabel || "No cards"}
            </div>
        );
    }

    return cards.map((cardInstance: CardInstance, cardIndex) => {
        const rotation = rotations[cardIndex];
        const cardStyle = {
            transform: `rotate(${rotation}deg)`,
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
                className="absolute w-24 mb-2"
                style={cardStyle}
            >
                {image}
            </div>
        );
    });
}
