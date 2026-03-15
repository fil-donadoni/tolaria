import { createContext, useContext } from "react";
import type { Id } from "@convex/_generated/dataModel";

type GameContext = {
    gameId: Id<"games">;
};

export const GameContext = createContext<GameContext | null>(null);

export function useGameContext(): GameContext {
    const ctx = useContext(GameContext);
    if (!ctx) throw new Error("useGameContext must be used within GameContext.Provider");
    return ctx;
}
