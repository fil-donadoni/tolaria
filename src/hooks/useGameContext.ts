import { createContext, useContext } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Combat, PendingCast, PendingTarget, Player } from "~/types/game";

type GameContext = {
    gameId: Id<"games">;
    playerId: string;
    activePlayerId: string;
    priorityPlayerId: string;
    phase: string;
    turn: number;
    pendingCast?: PendingCast;
    pendingTarget?: PendingTarget;
    autoPassPlayers?: string[];
    undoableBy?: string;
    combat?: Combat;
    allPlayers: Player[];
    showAllCards: boolean;
    debugAllActions: boolean;
};

export const GameContext = createContext<GameContext | null>(null);

export function useGameContext(): GameContext {
    const ctx = useContext(GameContext);
    if (!ctx)
        throw new Error(
            "useGameContext must be used within GameContext.Provider"
        );
    return ctx;
}
