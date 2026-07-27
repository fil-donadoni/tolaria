import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";
import { getCurrentUserId } from "./auth";

/**
 * Game statuses that count as "active": the user is occupying a seat and must
 * finish (concede) or leave before starting another. Finished games — which
 * accumulate in the table forever — never count.
 */
export const ACTIVE_GAME_STATUSES = ["waiting", "playing"] as const;

/**
 * A single seat handle belongs to `userId` when it equals the user's id
 * (2-player game, `players[].id === userId`) or one of the solo seats
 * `${userId}-p1` / `${userId}-p2` (CLAUDE.md § Player identity in games).
 * Convex document ids contain no `-`, so the prefix test is unambiguous and
 * won't collide with a different user's id.
 *
 * The single authority on "is this seat MINE" — the SEAT-level question, which
 * `gameBelongsToUser` / `matchBelongsToUser` (DOC-level: "am I *in* this
 * game/match") deliberately do not answer.
 */
export function seatBelongsToUser(playerId: string, userId: string): boolean {
    return playerId === userId || playerId.startsWith(`${userId}-`);
}

/**
 * Assert the authenticated caller owns the seat they named (issue #1645
 * review). Every mutation that takes a CLIENT-SUPPLIED seat handle and writes
 * a RESULT from it — concede, forfeit, anything that finishes a Game or Match
 * — must call this: the doc-level `gameBelongsToUser`/`matchBelongsToUser`
 * checks only prove the caller is *in* the game, so on their own they let
 * either seat of a 2-player Match name the OPPONENT as the loser. Since a
 * pairing Match's result lands in the Limited standings (PRD #1628), that is a
 * scoring exploit, not just a griefing one.
 *
 * Solo play still works: one user legitimately drives BOTH `-p1` and `-p2`.
 */
export function assertSeatOwnership(playerId: string, userId: string): void {
    if (!seatBelongsToUser(playerId, userId))
        throw new Error("You cannot act as another player.");
}

/**
 * The ctx-taking form of `assertSeatOwnership` — the one line every gameplay
 * mutation that takes a CLIENT-SUPPLIED seat handle opens with (issue #1645
 * review).
 *
 * The criterion is "can a caller act AS another seat?", NOT "does this mutation
 * itself finish the game?". The narrower reading is what left the hole: `mill`
 * and `exileFromLibrary` finish nothing on their own, yet `mill({ playerId:
 * opponent })` xN followed by `drawCard({ playerId: opponent })` empties the
 * opponent's library and trips `hasDrawnFromEmpty` -> `checkStateBasedActions`
 * -> `finalizeGameOver` -> `recordLimitedPairingResult`. The SBA sweep is the
 * DELIVERY MECHANISM, not a safety net. Every seat-addressed mutation is in
 * the class, so all of them are gated uniformly rather than by case-by-case
 * judgement about which one lands the killing blow.
 *
 * Uses `getCurrentUserId` (auth token only) rather than `getCurrentUser` (an
 * extra document read) — this runs on every gameplay action.
 *
 * NOT the bot-seat gate. In a vs-AI game the client-side Brain legitimately
 * drives `${uid}-p2`, a handle the user DOES own, so this passes and vs-AI
 * keeps working. Blocking the bot seat is a strictly higher bar reserved for
 * the two resignation paths — see `assertNotEventBotSeat` in `matches.ts`.
 */
export async function assertCallerOwnsSeat(
    ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
    playerId: string
): Promise<void> {
    assertSeatOwnership(playerId, await getCurrentUserId(ctx));
}

/**
 * A player handle belongs to `userId` when it equals the user's id (2-player
 * game, `players[].id === userId`) or one of the solo seats `${userId}-p1` /
 * `${userId}-p2`. Convex document ids contain no `-`, so the prefix test is
 * unambiguous and won't collide with a different user's id.
 */
export function gameBelongsToUser(
    game: { players: { id: string }[] },
    userId: string
): boolean {
    return game.players.some((p) => seatBelongsToUser(p.id, userId));
}

/**
 * The user's current active game, or null. Scans only the small
 * waiting/playing set via the `by_status` index — finished games are never
 * read, so this stays cheap as the table grows.
 *
 * This is the server-side single-active-game guard (#155): create/join
 * mutations call it and reject when it returns a game. Because Convex
 * mutations run in serializable transactions, a double-click / two-tab race
 * that both read "no active game" forces an OCC retry on the loser, which
 * then sees the freshly inserted game and is rejected — so at most one game
 * is ever created.
 */
export async function findActiveGameForUser(
    ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>,
    userId: string
): Promise<Doc<"games"> | null> {
    for (const status of ACTIVE_GAME_STATUSES) {
        const games = await ctx.db
            .query("games")
            .withIndex("by_status", (q) => q.eq("status", status))
            .collect();
        const mine = games.find((g) => gameBelongsToUser(g, userId));
        if (mine) return mine;
    }
    return null;
}
