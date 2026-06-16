import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./_generated/dataModel";

/**
 * Game statuses that count as "active": the user is occupying a seat and must
 * finish (concede) or leave before starting another. Finished games — which
 * accumulate in the table forever — never count.
 */
export const ACTIVE_GAME_STATUSES = ["waiting", "playing"] as const;

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
    return game.players.some(
        (p) => p.id === userId || p.id.startsWith(`${userId}-`)
    );
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
