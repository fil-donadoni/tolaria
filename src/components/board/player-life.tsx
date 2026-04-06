import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

type PlayerLifeProps = {
    player: Player;
};

export default function PlayerLife({ player }: PlayerLifeProps) {
    const { gameId, playerId, priorityPlayerId, pendingTarget } =
        useGameContext();
    const isMe = player.id === playerId;
    const hasPriority = player.id === priorityPlayerId;
    const selectTargetMut = useMutation(api.game.selectTarget);

    const isTargetable =
        !!pendingTarget &&
        pendingTarget.playerId === playerId &&
        (pendingTarget.targetType === "player" ||
            pendingTarget.targetType === "any");

    function handleClick() {
        if (!isTargetable) return;
        selectTargetMut({
            gameId,
            playerId,
            targetType: "player",
            targetId: player.id,
        });
    }

    return (
        <div
            className={`bg-slate-900 text-white text-center p-4 rounded-md absolute left-1/2 -translate-x-1/2 ${isMe ? "bottom-4" : "top-20"} ${hasPriority ? "ring-2 ring-yellow-400" : ""} ${isTargetable ? "ring-2 ring-orange-400 cursor-pointer hover:ring-orange-300" : ""}`}
            onClick={handleClick}
        >
            <h2 className="text-5xl font-bold text-center">{player.life}</h2>
            <p>{player.name}</p>
        </div>
    );
}
