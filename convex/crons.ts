import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { deleteMatchCascade } from "./matches";

const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;

/** Garbage-collect finished Matches older than `FINISHED_TTL_MS` (ADR 0029).
 *  Deleting a Match cascades its Games and their `game_states` snapshots in one
 *  pass. Run on a cron so abandoned/finished sessions don't accumulate storage.
 *
 *  Defensively also sweeps any finished game NOT owned by a Match (legacy rows
 *  predating the Match table) so old data still drains. */
export const sweepFinishedGames = internalMutation({
    handler: async (ctx) => {
        const cutoff = Date.now() - FINISHED_TTL_MS;

        const finishedMatches = await ctx.db
            .query("matches")
            .withIndex("by_status", (q) => q.eq("status", "finished"))
            .collect();
        for (const match of finishedMatches) {
            if (match.updatedAt > cutoff) continue;
            await deleteMatchCascade(ctx, match._id);
        }

        // Legacy fallback: finished games with no owning Match.
        const finishedGames = await ctx.db
            .query("games")
            .withIndex("by_status", (q) => q.eq("status", "finished"))
            .collect();
        for (const game of finishedGames) {
            if (game.matchId) continue; // owned — handled by Match sweep
            if (game.updatedAt > cutoff) continue;
            const snapshots = await ctx.db
                .query("game_states")
                .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
                .collect();
            for (const s of snapshots) await ctx.db.delete(s._id);
            await ctx.db.delete(game._id);
        }
    },
});

const crons = cronJobs();

crons.interval(
    "sweep finished games",
    { hours: 6 },
    internal.crons.sweepFinishedGames
);

export default crons;
