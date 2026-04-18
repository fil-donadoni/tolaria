import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type {
    Combat,
    GameOver,
    PendingCast,
    PendingTarget,
    Player,
    StackItem,
} from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";
import { usePageVisible } from "~/hooks/usePageVisible";
import PlayerBoard from "./player-board";
import GameStack from "./game-stack";
import PhaseTracker from "./phase-tracker";
import PassPriorityButton from "./pass-priority-button";
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
    const state = useQuery(
        api.game.getFullState,
        pageVisible ? { gameId, debugAllActions } : "skip"
    );

    if (!state) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const allPlayers = state.players as unknown as Player[];
    const stack = (state as unknown as { stack: StackItem[] }).stack ?? [];
    const activePlayerId = (state as unknown as { activePlayerId: string })
        .activePlayerId;
    const priorityPlayerId =
        (state as unknown as { priorityPlayerId: string }).priorityPlayerId ??
        activePlayerId;
    const phase = (state as unknown as { phase: string }).phase ?? "UPKEEP";
    const turn = (state as unknown as { turn: number }).turn ?? 1;
    const pendingCast = (state as unknown as { pendingCast?: PendingCast })
        .pendingCast;
    const autoPassPlayers = (state as unknown as { autoPassPlayers?: string[] })
        .autoPassPlayers;
    const combat = (state as unknown as { combat?: Combat }).combat;
    const pendingTarget = (
        state as unknown as { pendingTarget?: PendingTarget }
    ).pendingTarget;
    const undoableBy = (state as unknown as { undoableBy?: string }).undoableBy;
    const gameOver = (state as unknown as { gameOver?: GameOver }).gameOver;

    // Opponent on top, local player on bottom
    const opponent = allPlayers.find((p) => p.id !== playerId);
    const me = allPlayers.find((p) => p.id === playerId);
    const orderedPlayers = [opponent, me].filter(Boolean) as Player[];

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
                <PassPriorityButton />
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
