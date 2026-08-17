// The `limitedCubePools` seam: the ONE module that reads or writes a cube
// Draft's frozen card pool (ADR 0062), which lives in its own table rather
// than inline on the event row — see `convex/schema.ts`'s `limitedCubePools`
// comment for why (Convex bills a read by the whole document's bytes, and the
// pool was 73% of a 16 KB event row that seven prod functions re-read while
// only the round deal needs it).
//
// Legacy tolerance mirrors `convex/limitedSeatStore.ts`: an event started
// BEFORE the split still carries its pool inline on `cubePool`, and `loadCubePool`
// folds that copy in when no child row exists, so an un-migrated draft keeps
// dealing its remaining rounds from the same frozen permutation.
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** This event's frozen cube pool, or `undefined` when it isn't a cube event.
 *
 *  Child row first, inline legacy copy second. Never falls back to
 *  `buildCubePool()`: re-deriving the pool is exactly the drift ADR 0062
 *  froze it against, so a cube event whose pool is genuinely missing must
 *  surface as the deal throwing, not as a silently reshuffled draft. */
export async function loadCubePool(
    ctx: QueryCtx,
    event: Doc<"limitedEvents">
): Promise<string[] | undefined> {
    const row = await ctx.db
        .query("limitedCubePools")
        .withIndex("by_event", (q) => q.eq("eventId", event._id))
        .unique();
    if (row) return row.pool;
    return event.cubePool;
}

/** Freezes `pool` for `eventId` — called once, from `startLimitedEvent`.
 *
 *  Overwrites rather than skips an existing row so a re-start (a cancelled
 *  event's id reused by a debug path) can't deal round 0 from one permutation
 *  and round 1 from another. */
export async function saveCubePool(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    pool: readonly string[]
): Promise<void> {
    const row = await ctx.db
        .query("limitedCubePools")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .unique();
    if (row) {
        await ctx.db.replace(row._id, { eventId, pool: [...pool] });
        return;
    }
    await ctx.db.insert("limitedCubePools", { eventId, pool: [...pool] });
}

/** Deletes the pool row of an event — for the event's own deletion (cancel /
 *  GC), which would otherwise orphan it. A no-op for a non-cube event. */
export async function deleteCubePool(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">
): Promise<void> {
    const row = await ctx.db
        .query("limitedCubePools")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .unique();
    if (row) await ctx.db.delete(row._id);
}
