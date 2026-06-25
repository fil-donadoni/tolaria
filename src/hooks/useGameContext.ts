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
    queuedEndTurn?: string[];
    combat?: Combat;
    /** Melee (#669) — the attacking (active) player declares blocks this
     *  combat. Flows from the projected GameState so block-declaration UI flips
     *  to the right seat. */
    meleeCombat?: boolean;
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
