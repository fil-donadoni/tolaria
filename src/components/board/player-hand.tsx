import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import {
    getFanStyle,
    fanCardClassName,
    fanCardOpponentClassName,
} from "~/lib/card-layout";
import SelectableCard from "../cards/selectable-card";
import CardBack from "../cards/card-back";

type HandProps = {
    player: Player;
};

export default function PlayerHand({ player }: HandProps) {
    const { playerId, showAllCards } = useGameContext();
    const isMe = player.id === playerId;
    const canSeeCards = isMe || showAllCards;
    const isOpponent = !isMe;

    const cardsInHand = player.hand.map((cardInstance, cardIndex) => {
        const style = getFanStyle(cardIndex, player.hand.length, isOpponent);
        // Opponent's hand comes as nulls from getPublicState: render backs only.
        const key = cardInstance ? cardInstance.id : `hidden-${cardIndex}`;

        return (
            <div
                key={key}
                className={
                    isOpponent ? fanCardOpponentClassName : fanCardClassName
                }
                style={style}
            >
                {canSeeCards && cardInstance ? (
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
    });

    return <div className="flex justify-center items-end">{cardsInHand}</div>;
}
