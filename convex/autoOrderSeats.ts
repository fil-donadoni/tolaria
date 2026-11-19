// Auto-order preference (issue #9988): which seats of a Game asked the GRE to
// answer the CR 603.3b trigger-order and CR 404.3 graveyard-arrangement
// prompts itself. The preference is per USER (`userSettings.autoOrderPrompts`);
// this module lowers it to the seat handles `state.autoOrderSeatIds` carries.

import type { GenericId } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { isBotSeat } from "./matches";

type ReadCtx = Pick<GenericQueryCtx<DataModel>, "db">;

/** The seat handle's owning user id: `players[].id` is the user id itself
 *  (2-player) or `${userId}-p1` / `${userId}-p2` (solo; CLAUDE.md § Player
 *  identity in games). Convex ids contain no `-`. */
function seatUserId(seatId: string): string {
    return seatId.replace(/-p[12]$/, "");
}

/** Seats of `gameId` whose user turned the preference on. The Bot seat of a
 *  vs-AI Game is never listed: the Bot orders by search, not by preference.
 *  Empty when nobody opted in (the default), so callers can skip the field. */
export async function loadAutoOrderSeatIds(
    ctx: ReadCtx,
    gameId: GenericId<"games">,
    seatIds: readonly string[]
): Promise<string[]> {
    const game = await ctx.db.get(gameId);
    const optedIn = new Map<string, boolean>();
    const seats: string[] = [];
    for (const seatId of seatIds) {
        if (game?.vsAi === true && isBotSeat(seatId)) continue;
        const rawUserId = seatUserId(seatId);
        let on = optedIn.get(rawUserId);
        if (on === undefined) {
            const userId = ctx.db.normalizeId("users", rawUserId);
            const row = userId
                ? await ctx.db
                      .query("userSettings")
                      .withIndex("by_user", (q) => q.eq("userId", userId))
                      .unique()
                : null;
            on = row?.autoOrderPrompts === true;
            optedIn.set(rawUserId, on);
        }
        if (on) seats.push(seatId);
    }
    return seats;
}
