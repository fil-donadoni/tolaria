import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { deleteMatchCascade } from "./matches";
import { deleteSeats } from "./limitedSeatStore";

const FINISHED_TTL_MS = 24 * 60 * 60 * 1000;

/** Garbage-collect finished Matches older than `FINISHED_TTL_MS` (ADR 0029).
 *  Deleting a Match cascades its Games and their `gameStates` snapshots in one
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
                .query("gameStates")
                .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
                .collect();
            for (const s of snapshots) await ctx.db.delete(s._id);
            // Tick row companion (PRD #1776 T3, issue #1778) — same orphan
            // risk as `gameStates` for a match-less legacy game row.
            const ticks = await ctx.db
                .query("gameTicks")
                .withIndex("by_gameId", (q) => q.eq("gameId", game._id))
                .collect();
            for (const t of ticks) await ctx.db.delete(t._id);
            await ctx.db.delete(game._id);
        }
    },
});

const OPEN_EVENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Garbage-collect Limited Events that were created, never started, and then
 *  abandoned — the only events that can be dropped without destroying real
 *  player work. An `open` event has no Pools, no submitted decks and no
 *  Matches bound to it (all three only come into existence at
 *  `startLimitedEvent`), so deleting one is exactly what its creator's own
 *  `cancelLimitedEvent` does.
 *
 *  Deliberately does NOT sweep started/finished events: their seats' Pools are
 *  what every `userDecks` row of format `limited` resolves its legality
 *  against (`convex/limited/poolResolution.ts`), so deleting one would
 *  silently invalidate a player's saved decks. Unbounded growth there is
 *  acceptable now that an event row is slim — the card payload sits in
 *  `limitedSeats` and is only read when the event is actually opened. */
export const sweepAbandonedLimitedEvents = internalMutation({
    handler: async (ctx) => {
        const cutoff = Date.now() - OPEN_EVENT_TTL_MS;
        const open = await ctx.db
            .query("limitedEvents")
            .withIndex("by_status", (q) => q.eq("status", "open"))
            .collect();
        for (const event of open) {
            if (event.updatedAt > cutoff) continue;
            // An open event should have no payload rows, but delete them first
            // regardless — a row orphaned by a missing parent is unreachable.
            await deleteSeats(ctx, event._id);
            await ctx.db.delete(event._id);
        }
    },
});

const crons = cronJobs();

crons.interval(
    "sweep finished games",
    { hours: 6 },
    internal.crons.sweepFinishedGames
);

crons.interval(
    "sweep abandoned limited events",
    { hours: 24 },
    internal.crons.sweepAbandonedLimitedEvents
);

export default crons;
