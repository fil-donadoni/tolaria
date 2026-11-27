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
//
// Each row also carries `active`: false once its event has concluded. It is
// what lets `loadActiveMemberEvents` serve "this User's live events" by
// index without reading a single concluded event row. Like the row itself it
// is a derived hint — the event's own `status` stays the authority, so a row
// whose flag is missing (written before the field) or stale is read and
// re-checked, never trusted.
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
    isEventConcluded,
    type LimitedEventStatus,
} from "./limited/eventStatus";

/** The `active` flag a membership row of an event in `status` carries. */
export function isMembershipActive(status: LimitedEventStatus): boolean {
    return !isEventConcluded(status);
}

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
 *  an unchanged table writes nothing). Idempotent.
 *
 *  With the event's `status`, also brings each row's `active` flag in step.
 *  Without it (a seat save that does not write the status) existing flags are
 *  left alone and an inserted row carries none — read as unknown, never as
 *  inactive, so the omission costs a read and never hides an event. */
export async function syncEventMembers(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    seats: readonly { userId?: Id<"users"> | string }[],
    status?: LimitedEventStatus
): Promise<void> {
    const active =
        status === undefined ? undefined : isMembershipActive(status);
    const wanted = new Set(seatedUserIds(seats));
    const rows = await ctx.db
        .query("limitedEventMembers")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    const present = new Set<Id<"users">>();
    for (const row of rows) {
        if (wanted.has(row.userId) && !present.has(row.userId)) {
            present.add(row.userId);
            if (active !== undefined && row.active !== active) {
                await ctx.db.patch(row._id, { active });
            }
            continue;
        }
        // Departed User, or a duplicate row for one still seated.
        await ctx.db.delete(row._id);
    }
    for (const userId of wanted) {
        if (present.has(userId)) continue;
        await ctx.db.insert("limitedEventMembers", {
            userId,
            eventId,
            ...(active === undefined ? {} : { active }),
        });
    }
}

/** Flags every membership row of `eventId` inactive — called in the same
 *  mutation that writes the event's concluding `status`, so the event drops
 *  out of `loadActiveMemberEvents`' index read at once. */
export async function concludeEventMembers(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">
): Promise<void> {
    const rows = await ctx.db
        .query("limitedEventMembers")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    for (const row of rows) {
        if (row.active !== false)
            await ctx.db.patch(row._id, { active: false });
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
    return readSeatedEvents(ctx, userId, rows);
}

/** Every event `userId` holds a Seat in that has not concluded, newest first
 *  — `loadMemberEvents` narrowed to live events, with the same answer as
 *  filtering its result by `!isEventConcluded`.
 *
 *  Reads only the membership rows flagged `active: true` or carrying no flag
 *  yet (a row written before the field, unknown until the backfill reaches
 *  it), then only those events: a concluded event whose rows were flagged
 *  when it concluded is never read, however long the User's history. */
export async function loadActiveMemberEvents(
    ctx: QueryCtx,
    userId: Id<"users">
): Promise<Doc<"limitedEvents">[]> {
    const [flagged, unflagged] = await Promise.all(
        [true, undefined].map((active) =>
            ctx.db
                .query("limitedEventMembers")
                .withIndex("by_user_active", (q) =>
                    q.eq("userId", userId).eq("active", active)
                )
                .collect()
        )
    );
    const events = await readSeatedEvents(ctx, userId, [
        ...flagged,
        ...unflagged,
    ]);
    return events.filter((event) => !isEventConcluded(event.status));
}

/** The event rows `rows` point at that `userId` is really seated in (the
 *  event's own `seats` re-checked), newest first. */
async function readSeatedEvents(
    ctx: QueryCtx,
    userId: Id<"users">,
    rows: readonly Doc<"limitedEventMembers">[]
): Promise<Doc<"limitedEvents">[]> {
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

/** One bounded step of the `active` backfill: flags up to `limit` membership
 *  rows that carry no flag yet from their event's `status` (a row whose event
 *  is gone reads inactive — nothing live can surface through it). Returns how
 *  many it flagged and how many unflagged rows are left past the bound.
 *  Idempotent: a flagged row is never rewritten. */
export async function backfillMemberActiveStep(
    ctx: MutationCtx,
    limit: number
): Promise<{ flagged: number; remaining: number }> {
    // No index can express "has no flag" across Users, so the walk is the
    // whole table — one membership row per seated (User, event), ~100 bytes.
    const rows = await ctx.db.query("limitedEventMembers").collect();
    let flagged = 0;
    let remaining = 0;
    for (const row of rows) {
        if (row.active !== undefined) continue;
        if (flagged >= limit) {
            remaining++;
            continue;
        }
        const event = await ctx.db.get(row.eventId);
        await ctx.db.patch(row._id, {
            active: event !== null && isMembershipActive(event.status),
        });
        flagged++;
    }
    return { flagged, remaining };
}
