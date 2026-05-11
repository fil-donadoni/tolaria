import { createContext, useContext } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Phase } from "@convex/gre/types";
import type {
    Combat,
    GameOver,
    PendingActivation,
    PendingCast,
    PendingChoice,
    PendingTarget,
    Player,
} from "~/types/game";

type GameContext = {
    gameId: Id<"games">;
    playerId: string;
    activePlayerId: string;
    priorityPlayerId: string;
    phase: Phase;
    turn: number;
    stackCount: number;
    pendingCast?: PendingCast;
    pendingActivation?: PendingActivation;
    pendingTarget?: PendingTarget;
    pendingChoices?: PendingChoice[];
    autoPassPlayers?: string[];
    combat?: Combat;
    gameOver?: GameOver;
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
