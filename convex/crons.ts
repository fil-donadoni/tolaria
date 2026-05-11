import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;

/** Garbage-collect finished games older than `FINISHED_TTL_MS`. Removes the
 *  game doc and all its `game_states` snapshots in one pass. Run on a cron so
 *  abandoned/finished sessions don't accumulate storage or appear in any
 *  lobby/match listing. */
export const sweepFinishedGames = internalMutation({
    handler: async (ctx) => {
        const cutoff = Date.now() - FINISHED_TTL_MS;
        const finished = await ctx.db
            .query("games")
            .withIndex("by_status", (q) => q.eq("status", "finished"))
            .collect();
        for (const game of finished) {
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
