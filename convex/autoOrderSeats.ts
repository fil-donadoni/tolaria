// Auto-order preference (issue #9988): which seats of a Game asked the GRE to
// answer the CR 603.3b trigger-order and CR 404.3 graveyard-arrangement
// prompts itself. The preference is per USER (`userSettings.autoOrderPrompts`);
// this module lowers it to the seat handles `state.autoOrderSeatIds` carries.

import type { GenericId } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
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
    // Only a `-p2` seat can be the Bot's, and only a vs-AI Game has one — the
    // Game row is read lazily, for that seat alone.
    let vsAi: boolean | undefined;
    const optedIn = new Map<string, boolean>();
    const seats: string[] = [];
    for (const seatId of seatIds) {
        if (isBotSeat(seatId)) {
            vsAi ??= (await ctx.db.get(gameId))?.vsAi === true;
            if (vsAi) continue;
        }
        const rawUserId = seatUserId(seatId);
        let on = optedIn.get(rawUserId);
        if (on === undefined) {
            // A handle that is no user id (a scenario seat) matches no row.
            const row = await ctx.db
                .query("userSettings")
                .withIndex("by_user", (q) =>
                    q.eq("userId", rawUserId as Id<"users">)
                )
                .unique();
            on = row?.autoOrderPrompts === true;
            optedIn.set(rawUserId, on);
        }
        if (on) seats.push(seatId);
    }
    return seats;
}
