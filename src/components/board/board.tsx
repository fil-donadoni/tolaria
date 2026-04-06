import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingCast, Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import PlayerBoard from "./player-board";
import GameStack from "./game-stack";

type BoardProps = {
    gameId: Id<"games">;
    playerId: string;
    showAllCards: boolean;
    debugAllActions: boolean;
};

export default function Board({
    gameId,
    playerId,
    showAllCards,
    debugAllActions,
}: BoardProps) {
    const state = useQuery(api.game.getFullState, { gameId, debugAllActions });

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const allPlayers = state.players as unknown as Player[];
    const stack = (state as unknown as { stack: StackItem[] }).stack ?? [];
    const priorityPlayerId =
        (state as unknown as { priorityPlayerId: string }).priorityPlayerId ??
        (state as unknown as { activePlayerId: string }).activePlayerId;
    const pendingCast = (state as unknown as { pendingCast?: PendingCast })
        .pendingCast;

    // Opponent on top, local player on bottom
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const me = allPlayers.find((p) => p.id === playerId);
    const orderedPlayers = [opponent, me].filter(Boolean) as Player[];

    return (
        <GameContext
            value={{
                gameId,
                playerId,
                priorityPlayerId,
                pendingCast,
                showAllCards,
                debugAllActions,
            }}
        >
            <div className="flex h-full w-full flex-col relative">
                {orderedPlayers.map((player) => (
                    <PlayerBoard key={player.id} player={player} />
                ))}
                {stack.length > 0 && <GameStack stack={stack} />}
            </div>
        </GameContext>
    );
}
