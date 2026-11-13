// The two seats of a vs-AI game, and the proof the caller is its human player.
//
// Shared by every server path a vs-AI game's HUMAN calls about the Bot — the
// liveness hand-off and consult-failure record (`botLiveness.ts`) and the
// game-end Verdict Proposal judge's guard (`verdictJudgeGuard.ts`) — so the
// seat derivation and the ownership check are one function, never copies.
//
// A plain module (no Convex functions).

import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { assertSeatOwnership } from "./gameLifecycle";
import { botSeatId } from "./matches";

export type VsAiSeats = { botId: string; humanId: string };

/**
 * Throws for a game that is not vs-AI and for a caller who does not own the
 * human seat — in a vs-AI game the human owns BOTH handles (ADR 0000), so the
 * human seat is the one to check.
 */
export function vsAiSeats(game: Doc<"games">, userId: string): VsAiSeats {
    const botId = botSeatId(game);
    if (!botId) throw new ConvexError("This game has no Bot seat.");
    const human = game.players.find((p) => p.id !== botId);
    if (!human) throw new ConvexError("This game has no human seat.");
    try {
        assertSeatOwnership(human.id, userId);
    } catch {
        throw new ConvexError("You are not the player of this game.");
    }
    return { botId, humanId: human.id };
}
