// The `gamePrefs` table (ADR 0077): each seat's Phase Stop preferences for
// one Game, kept OUT of `gameStates` so the row every save rewrites does not
// carry them and a preference change bumps no `seq`. This module is the only
// reader and writer of the table.

import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { mutation } from "./_generated/server";
import { assertCallerOwnsSeat } from "./gameLifecycle";
import {
    DEFAULT_SKIP_PREFS,
    sanitizeSkipPrefs,
    type PhaseSkipPrefs,
} from "./phaseStopPrefs";

type ReadCtx = Pick<GenericQueryCtx<DataModel>, "db">;
type WriteCtx = Pick<GenericMutationCtx<DataModel>, "db">;

/** Every seat's stored Phase Stop preferences for `gameId`, keyed by seat id
 *  — the value `passPriority` hangs on `state.seatSkipPrefs`. A seat with no
 *  row is absent, and an absent seat is never skipped (ADR 0077 §5). */
export async function loadSeatSkipPrefs(
    ctx: ReadCtx,
    gameId: Id<"games">
): Promise<Record<string, PhaseSkipPrefs>> {
    const rows = await ctx.db
        .query("gamePrefs")
        .withIndex("by_game_player", (q) => q.eq("gameId", gameId))
        .collect();
    const bySeat: Record<string, PhaseSkipPrefs> = {};
    for (const row of rows) {
        bySeat[row.playerId] = sanitizeSkipPrefs(row.skipPrefs);
    }
    return bySeat;
}

async function upsertSkipPrefs(
    ctx: WriteCtx,
    gameId: Id<"games">,
    playerId: string,
    skipPrefs: PhaseSkipPrefs
): Promise<void> {
    const existing = await ctx.db
        .query("gamePrefs")
        .withIndex("by_game_player", (q) =>
            q.eq("gameId", gameId).eq("playerId", playerId)
        )
        .first();
    if (!existing) {
        await ctx.db.insert("gamePrefs", { gameId, playerId, skipPrefs });
        return;
    }
    if (JSON.stringify(existing.skipPrefs) === JSON.stringify(skipPrefs)) {
        return;
    }
    await ctx.db.patch(existing._id, { skipPrefs });
}

/** The Bot seat has no client to send preferences, and an absent row stops
 *  the drain at every one of its windows — so a vs-AI Game seeds it with the
 *  defaults a human on empty storage has (ADR 0077 §4). */
export async function seedBotSkipPrefs(
    ctx: WriteCtx,
    gameId: Id<"games">,
    botPlayerId: string
): Promise<void> {
    await upsertSkipPrefs(ctx, gameId, botPlayerId, DEFAULT_SKIP_PREFS);
}

export async function deleteGamePrefs(
    ctx: WriteCtx,
    gameId: Id<"games">
): Promise<void> {
    const rows = await ctx.db
        .query("gamePrefs")
        .withIndex("by_game_player", (q) => q.eq("gameId", gameId))
        .collect();
    for (const row of rows) await ctx.db.delete(row._id);
}

/** Store the caller's Phase Stop preferences for the seats they name. The
 *  client sends them on game entry and on every toggle; a solo game names
 *  both seats (one user plays both), every other mode its own. Writes
 *  `gamePrefs` only — no `gameStates` save, no `seq` bump, no subscriber
 *  re-run. */
export const setSkipPrefs = mutation({
    args: {
        gameId: v.id("games"),
        playerIds: v.array(v.string()),
        skipPrefs: v.any(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        // SECURITY: seat-addressed — the caller must own every handle named,
        // and the handle must be a seat of THIS game, or a caller could park
        // rows under a game they are not in.
        const game = await ctx.db.get(args.gameId);
        if (!game) throw new Error("Game not found");
        const skipPrefs = sanitizeSkipPrefs(args.skipPrefs);
        for (const playerId of new Set(args.playerIds)) {
            await assertCallerOwnsSeat(ctx, playerId);
            if (!game.players.some((p) => p.id === playerId)) {
                throw new Error("Not a seat of this game");
            }
            await upsertSkipPrefs(ctx, args.gameId, playerId, skipPrefs);
        }
        return null;
    },
});
