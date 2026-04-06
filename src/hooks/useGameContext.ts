import { createContext, useContext } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingCast } from "~/types/game";

type GameContext = {
    gameId: Id<"games">;
    playerId: string;
    priorityPlayerId: string;
    pendingCast?: PendingCast;
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
