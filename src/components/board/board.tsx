import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import PlayerBoard from "./player-board";

type BoardProps = {
    gameId: Id<"games">;
    playerId: string;
    showAllCards: boolean;
};

export default function Board({ gameId, playerId, showAllCards }: BoardProps) {
    const state = useQuery(api.game.getFullState, { gameId });

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const allPlayers = state.players as unknown as Player[];

    // Opponent on top, local player on bottom
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const me = allPlayers.find((p) => p.id === playerId);
    const orderedPlayers = [opponent, me].filter(Boolean) as Player[];

    return (
        <GameContext value={{ gameId, playerId, showAllCards }}>
            <div className="flex h-full w-full flex-col">
                {orderedPlayers.map((player) => (
                    <PlayerBoard key={player.id} player={player} />
                ))}
            </div>
        </GameContext>
    );
}
