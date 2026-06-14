// Translates a BotAction into the EXISTING game mutation that realises it
// (ADR 0001, issue #109). No new Convex move surface: the bot submits the same
// mutations a human would, validated server-side identically.

import type { Id } from "@convex/_generated/dataModel";
import type { BotAction } from "./brain";

/** The mutation a BotAction maps to. `null` for `none` (no action owed). */
export function mutationForBotAction(
    action: BotAction
):
    | "declareMulligan"
    | "confirmAttackers"
    | "confirmBlockers"
    | "passPriority"
    | null {
    switch (action.kind) {
        case "keep":
            return "declareMulligan";
        case "declare-attackers":
            return "confirmAttackers";
        case "declare-blockers":
            return "confirmBlockers";
        case "pass":
            return "passPriority";
        case "none":
            return null;
    }
}

/** The concrete mutation callables the executor needs. Each accepts the
 *  standard `{ gameId, playerId }` (declareMulligan also a decision). */
export type BotMutations = {
    declareMulligan: (a: {
        gameId: Id<"games">;
        playerId: string;
        decision: "keep" | "mull";
    }) => Promise<unknown>;
    confirmAttackers: (a: {
        gameId: Id<"games">;
        playerId: string;
    }) => Promise<unknown>;
    confirmBlockers: (a: {
        gameId: Id<"games">;
        playerId: string;
    }) => Promise<unknown>;
    passPriority: (a: {
        gameId: Id<"games">;
        playerId: string;
    }) => Promise<unknown>;
};

/** Fire the mutation for `action` on behalf of the bot seat. Resolves to false
 *  when there is nothing to do. Server validation rejects stale/illegal
 *  submissions; callers should swallow those (the next state change re-drives). */
export async function executeBotAction(
    action: BotAction,
    deps: { gameId: Id<"games">; botId: string; mutations: BotMutations }
): Promise<boolean> {
    const { gameId, botId, mutations } = deps;
    switch (action.kind) {
        case "keep":
            await mutations.declareMulligan({
                gameId,
                playerId: botId,
                decision: "keep",
            });
            return true;
        case "declare-attackers":
            await mutations.confirmAttackers({ gameId, playerId: botId });
            return true;
        case "declare-blockers":
            await mutations.confirmBlockers({ gameId, playerId: botId });
            return true;
        case "pass":
            await mutations.passPriority({ gameId, playerId: botId });
            return true;
        case "none":
            return false;
    }
}
