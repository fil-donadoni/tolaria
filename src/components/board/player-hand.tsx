import type { CardInstance, Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { getFanStyle, fanCardClassName } from "~/lib/card-layout";
import SelectableCard from "../cards/selectable-card";
import CardBack from "../cards/card-back";

type HandProps = {
    player: Player;
};

export default function PlayerHand({ player }: HandProps) {
    const { playerId, showAllCards } = useGameContext();
    const isMe = player.id === playerId;
    const canSeeCards = isMe || showAllCards;

    const cardsInHand = player.hand.map(
        (cardInstance: CardInstance, cardIndex) => {
            const style = getFanStyle(cardIndex, player.hand.length);

            return (
                <div
                    key={cardInstance.id}
                    className={fanCardClassName}
                    style={style}
                >
                    {canSeeCards ? (
                        <SelectableCard
                            cardInstance={cardInstance}
                            allowedActions={
                                isMe ? (cardInstance.legalActions ?? []) : []
                            }
                        />
                    ) : (
                        <CardBack />
                    )}
                </div>
            );
        }
    );

    return (
        <div
            className={`absolute w-full h-1/3 p-4 ${isMe ? "bottom-0" : "top-0"}`}
        >
            <div className="flex justify-center">{cardsInHand}</div>
        </div>
    );
}
