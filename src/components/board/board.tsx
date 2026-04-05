import { useCallback, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Player, StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { CastErrorContext } from "~/hooks/useCastError";
import PlayerBoard from "./player-board";
import GameStack from "./game-stack";
import CastErrorToast from "./cast-error-toast";

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
    const [castError, setCastError] = useState<string | null>(null);
    const showError = useCallback((msg: string) => setCastError(msg), []);
    const dismissError = useCallback(() => setCastError(null), []);

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const allPlayers = state.players as unknown as Player[];
    const stack = (state as unknown as { stack: StackItem[] }).stack ?? [];

    // Opponent on top, local player on bottom
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const me = allPlayers.find((p) => p.id === playerId);
    const orderedPlayers = [opponent, me].filter(Boolean) as Player[];

    return (
        <GameContext
            value={{ gameId, playerId, showAllCards, debugAllActions }}
        >
            <CastErrorContext value={{ showError }}>
                <div className="flex h-full w-full flex-col relative">
                    {orderedPlayers.map((player) => (
                        <PlayerBoard key={player.id} player={player} />
                    ))}
                    {stack.length > 0 && <GameStack stack={stack} />}
                    <CastErrorToast
                        message={castError}
                        onDismiss={dismissError}
                    />
                </div>
            </CastErrorContext>
        </GameContext>
    );
}
