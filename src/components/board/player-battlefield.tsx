import type { CardInstance, Player } from "~/types/game";
import CardImage from "../card-image";

type BattlefieldProps = {
    player: Player;
};

export default function PlayerBattlefield({ player }: BattlefieldProps) {
    const cardsOnTheBattlefield = player.battlefield.map(
        (cardInstance: CardInstance, cardIndex) => (
            <div key={cardIndex} className="w-32 mb-2">
                <CardImage card={cardInstance.card} />
            </div>
        )
    );

    return (
        <div
            className={`absolute w-full h-2/3 p-4 ${player.id === "1" ? "bottom-0" : "top-0"}`}
        >
            <div className="flex gap-2 justify-center">
                {cardsOnTheBattlefield}
            </div>
        </div>
    );
}
