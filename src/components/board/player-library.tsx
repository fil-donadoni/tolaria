import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import CardsPile from "./cards-pile";

export default function PlayerLibrary({ player }: { player: Player }) {
    const { gameId, playerId } = useGameContext();
    const draw = useMutation(api.game.drawCard);
    const isMe = player.id === playerId;

    const handleClick = () => {
        if (isMe) {
            draw({ gameId, playerId });
        }
    };

    return (
        <div className="w-24 aspect-5/7">
            <div
                className={`relative ${isMe ? "cursor-pointer" : ""}`}
                onClick={handleClick}
            >
                <CardsPile
                    cards={player.library}
                    isFaceDown={true}
                    emptyLabel="Library is empty"
                />
            </div>
        </div>
    );
}
