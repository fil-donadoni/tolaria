import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import PlayerBoard from "./player-board";

export default function Board({ gameId }: { gameId: Id<"games"> }) {
    const state = useQuery(api.game.getFullState, { gameId });

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const players = state.players as unknown as Player[];

    return (
        <GameContext value={{ gameId }}>
            <div className="flex h-full w-full flex-col">
                {players.map((player, index) => (
                    <PlayerBoard key={index} player={player} />
                ))}
            </div>
        </GameContext>
    );
}
