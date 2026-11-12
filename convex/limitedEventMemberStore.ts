// The `limitedEventMembers` seam: the ONE module that reads or writes the
// (User, event) membership rows — the indexable mirror of
// `limitedEvents.seats[].userId` (see `convex/schema.ts`'s
// `limitedEventMembers` comment for why it exists).
//
// The event row stays the authority on who holds which Seat. This table is a
// derived index over it, kept in step by `syncEventMembers`, which every
// mutation that changes the set of seated Users calls with the seats it just
// wrote. Reads go the other way: `loadMemberEvents` answers "the events this
// User is seated in" by index, then re-checks each event row's own `seats`
// so a stale membership row can never surface an event the User is not
// actually seated in.
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** The distinct Users holding a Seat in `seats` (bots and empty seats carry
 *  no `userId`). A Dropped Seat keeps its User, so it counts. */
export function seatedUserIds(
    seats: readonly { userId?: Id<"users"> | string }[]
): Id<"users">[] {
    const ids = new Set<Id<"users">>();
    for (const seat of seats) {
        if (seat.userId !== undefined) ids.add(seat.userId as Id<"users">);
    }
    return [...ids];
}

/** Makes `eventId`'s membership rows match the Users seated in `seats`:
 *  inserts the missing, deletes the departed, leaves the rest untouched (so
 *  an unchanged table writes nothing). Idempotent. */
export async function syncEventMembers(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    seats: readonly { userId?: Id<"users"> | string }[]
): Promise<void> {
    const wanted = new Set(seatedUserIds(seats));
    const rows = await ctx.db
        .query("limitedEventMembers")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    const present = new Set<Id<"users">>();
    for (const row of rows) {
        if (wanted.has(row.userId) && !present.has(row.userId)) {
            present.add(row.userId);
            continue;
        }
        // Departed User, or a duplicate row for one still seated.
        await ctx.db.delete(row._id);
    }
    for (const userId of wanted) {
        if (present.has(userId)) continue;
        await ctx.db.insert("limitedEventMembers", { userId, eventId });
    }
}

/** Deletes every membership row of an event — for the event's own deletion
 *  (cancel / GC / fixture reset), which would otherwise orphan them. */
export async function deleteEventMembers(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">
): Promise<void> {
    const rows = await ctx.db
        .query("limitedEventMembers")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    for (const row of rows) await ctx.db.delete(row._id);
}

/** Every event `userId` holds a Seat in, newest first (`_creationTime`
 *  descending — the order the old table scan returned them in).
 *
 *  Reads the User's membership rows by index and then only those event rows:
 *  no other event is ever read. Each event's own `seats` is re-checked, so a
 *  membership row left behind by a missed sync hides nothing and shows
 *  nothing it should not. */
export async function loadMemberEvents(
    ctx: QueryCtx,
    userId: Id<"users">
): Promise<Doc<"limitedEvents">[]> {
    const rows = await ctx.db
        .query("limitedEventMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
    const eventIds = [...new Set(rows.map((row) => row.eventId))];
    const events = await Promise.all(eventIds.map((id) => ctx.db.get(id)));
    return events
        .filter(
            (event): event is Doc<"limitedEvents"> =>
                event !== null &&
                event.seats.some((seat) => seat.userId === userId)
        )
        .sort((a, b) => b._creationTime - a._creationTime);
}
