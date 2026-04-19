import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Player } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { usePageVisible } from "~/hooks/usePageVisible";
import PlayerBoard from "./player-board";
import GameStack from "./game-stack";
import PhaseTracker from "./phase-tracker";
import ActionBar from "./action-bar";
import GameOverDialog from "./game-over-dialog";
import TargetSelectionBanner from "./target-selection-banner";

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
    const pageVisible = usePageVisible();
    const publicState = useQuery(
        api.game.getPublicState,
        pageVisible && !showAllCards
            ? { gameId, playerId, debugAllActions }
            : "skip"
    );
    const fullState = useQuery(
        api.game.getFullState,
        pageVisible && showAllCards ? { gameId, debugAllActions } : "skip"
    );
    const state = showAllCards ? fullState : publicState;

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const allPlayers: Player[] = state.players;
    const stack = state.stack ?? [];
    const activePlayerId = state.activePlayerId;
    const priorityPlayerId = state.priorityPlayerId ?? activePlayerId;
    const phase = state.phase ?? "UPKEEP";
    const turn = state.turn ?? 1;
    const pendingCast = state.pendingCast;
    const autoPassPlayers = state.autoPassPlayers;
    const combat = state.combat;
    const pendingTarget = state.pendingTarget;
    const undoableBy = state.undoableBy;
    const gameOver = state.gameOver;

    // Opponent on top, local player on bottom
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const me = allPlayers.find((p) => p.id === playerId);
    const orderedPlayers = [opponent, me].filter(
        (p): p is Player => p !== undefined
    );

    return (
        <GameContext
            value={{
                gameId,
                playerId,
                activePlayerId,
                priorityPlayerId,
                phase,
                turn,
                pendingCast,
                pendingTarget,
                autoPassPlayers,
                undoableBy,
                combat,
                gameOver,
                allPlayers,
                showAllCards,
                debugAllActions,
            }}
        >
            <div className="flex h-full w-full flex-col relative">
                {orderedPlayers.map((player) => (
                    <PlayerBoard key={player.id} player={player} />
                ))}
                <PhaseTracker />
                {stack.length > 0 && <GameStack stack={stack} />}
                {pendingTarget && pendingTarget.playerId === playerId && (
                    <TargetSelectionBanner
                        pendingTarget={pendingTarget}
                        me={me}
                        gameId={gameId}
                        playerId={playerId}
                    />
                )}
                <ActionBar />
                {gameOver && (
                    <GameOverDialog
                        gameOver={gameOver}
                        allPlayers={allPlayers}
                    />
                )}
            </div>
        </GameContext>
    );
}
