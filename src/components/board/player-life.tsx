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
            data-arrow-anchor-player={player.id}
            className={`bg-slate-900 text-white text-center px-3 py-2 rounded-md shrink-0 ${hasPriority ? "ring-2 ring-yellow-400" : ""} ${isTargetable ? "ring-2 ring-orange-400 cursor-pointer hover:ring-orange-300" : ""}`}
            onClick={handleClick}
        >
            <h2 className="text-3xl font-bold leading-tight">{player.life}</h2>
            <p className="text-xs">{player.name}</p>
        </div>
    );
}
