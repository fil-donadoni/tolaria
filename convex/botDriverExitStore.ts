// The last time the human's vs-AI driver LEFT a game (issue #10006).
//
// The server deadline (`botLiveness.checkDeadline`) fires when no client moved
// the Bot's owed window for a full deadline. Two causes look identical from the
// server: a driver that died on a live board (a Bot fault, filed P0), and a
// player who simply left the game page while the Bot was owed. The second is
// not a fault — the deadline's force advance is the whole remedy, and a
// GitHub issue for it is noise in the P0 band.
//
// The driver says which, when it can (`src/hooks/useBotDriverExitReport.ts`):
// the player navigated away or swapped games (the effect's cleanup), closed
// the tab (`pagehide`) or hid it (`visibilitychange` → hidden, where the
// browser throttles or freezes the page and a phone OS suspends it) — each
// reports the state version it last saw with the Bot owed. The deadline then
// reads this row: an exit recorded at the SAME seq it is enforcing means the
// player was not at that position, so the window is advanced without a
// system report. A page that dies with no event at all (a crash, a killed
// process) records nothing and stays a reported fault.
//
// ONE row per game, patched in place; no consent-gated payload (the seq and a
// timestamp, both the server's own coordinates). Deleted with its game by
// `deleteGameCascade` (`matches.ts`). A plain module, read by `botLiveness`
// and the schema.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** The `botDriverExits` row's own fields. */
export const driverExitFields = {
    gameId: v.id("games"),
    /** The state version the driver last saw with the Bot owed. */
    seq: v.number(),
    at: v.number(),
};

/** The stored exit for a game, if its driver ever reported one. */
export async function readDriverExit(
    ctx: Pick<QueryCtx, "db">,
    gameId: Id<"games">
): Promise<Doc<"botDriverExits"> | null> {
    return await ctx.db
        .query("botDriverExits")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .unique();
}

/** Whether the deadline at `seq` is a player who left that position rather
 *  than a driver that died on it: an exit recorded at exactly that version.
 *  An exit at an OLDER seq says nothing — the game moved after it, so a
 *  driver was back. Pure. */
export function playerLeftAtSeq(
    exit: Pick<Doc<"botDriverExits">, "seq"> | null,
    seq: number
): boolean {
    return exit !== null && exit.seq === seq;
}
