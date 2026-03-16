import type { CardInstance, Player } from "~/types/game";
import SelectableCard from "../cards/selectable-card";

type HandProps = {
    player: Player;
};

export default function PlayerHand({ player }: HandProps) {
    const cardsInHand = player.hand.map(
        (cardInstance: CardInstance, cardIndex) => {
            const centerIndex = (player.hand.length - 1) / 2;
            const distanceFromCenter = cardIndex - centerIndex;

            const rotation = distanceFromCenter * 4;
            const marginTop = Math.abs(distanceFromCenter) * 8;

            const style = {
                transform: `rotate(${rotation}deg)`,
                marginLeft: cardIndex === 0 ? "0" : "-3rem",
                marginTop: `${marginTop}px`,
                transformOrigin: "bottom center",
            };

            return (
                <div
                    key={cardInstance.id}
                    className="w-32 mb-2 transition-all hover:-translate-y-8 hover:z-10"
                    style={style}
                >
                    <SelectableCard
                        cardInstance={cardInstance}
                        playerId={player.id}
                        allowedActions={cardInstance.legalActions ?? []}
                    />
                </div>
            );
        }
    );

    return (
        <div
            className={`absolute w-full h-1/3 p-4 ${player.id === "1" ? "top-0" : "bottom-0"}`}
        >
            <div className="flex justify-center">{cardsInHand}</div>
        </div>
    );
}
