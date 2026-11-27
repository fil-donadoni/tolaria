// The `limitedEventMembers` index (issue #6076): "which events am I seated
// in?" is answered by index, never by scanning the event table.
//
// The read-set assertions are the point. In Convex a query's read set is what
// its subscription re-executes on and what it is billed for, so a query that
// reads an event the viewer is not seated in returns the right answer and is
// still wrong: it re-runs on every pick at that table. The in-memory ctx
// records every executed query and every point `get`, which is what these
// tests assert on.
import { describe, it, expect } from "vitest";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
    backfillEventMemberActive,
    cancelLimitedEvent,
    createLimitedEvent,
    joinLimitedEvent,
    leaveLimitedEvent,
    migrateEventMembers,
    myCurrentLimitedEvents,
    myLimitedEvents,
} from "../limitedEvents";
import { deleteSeats, saveSeats } from "../limitedSeatStore";
import { assignFreeSeat, buildEmptySeats } from "../limited/eventLogic";
import { makeInMemoryDb, type InMemoryDb } from "./fixtures/inMemoryDb.fixture";

type Handler<A, R> = { _handler: (ctx: MutationCtx, args: A) => Promise<R> };
const handler = <A, R>(fn: unknown) => (fn as Handler<A, R>)._handler;

const create = handler<
    { type: "sealed" | "draft"; seatCount: number; packSource?: string },
    Id<"limitedEvents">
>(createLimitedEvent);
const join = handler<{ eventId: Id<"limitedEvents"> }, null>(joinLimitedEvent);
const leave = handler<{ eventId: Id<"limitedEvents"> }, null>(
    leaveLimitedEvent
);
const listAll = handler<Record<string, never>, { _id: string }[]>(
    myLimitedEvents
);
const listCurrent = handler<Record<string, never>, { _id: string }[]>(
    myCurrentLimitedEvents
);
const cancel = handler<{ eventId: Id<"limitedEvents"> }, null>(
    cancelLimitedEvent
);
const backfillActive = handler<
    { limit?: number },
    { flagged: number; remaining: number }
>(backfillEventMemberActive);
const backfill = handler<
    { cursor?: string | null; limit?: number },
    { synced: number; cursor: string; isDone: boolean }
>(migrateEventMembers);

const USERS = [
    { _id: "alice", nickname: "Alice" },
    { _id: "bob", nickname: "Bob" },
    { _id: "carol", nickname: "Carol" },
];

/** `db.ctx` re-authenticated as `userId`, over the SAME tables. */
function as(db: InMemoryDb, userId: string): MutationCtx {
    return {
        ...db.ctx,
        auth: {
            ...db.ctx.auth,
            getUserIdentity: async () => ({
                subject: `${userId}|session`,
                issuer: "test",
                tokenIdentifier: `test|${userId}`,
            }),
        },
    } as MutationCtx;
}

function members(db: InMemoryDb): [string, string][] {
    return (db.tables.limitedEventMembers ?? [])
        .map((row) => [row.userId as string, row.eventId as string])
        .sort() as [string, string][];
}

async function newEvent(db: InMemoryDb, creator: string) {
    return create(as(db, creator), {
        type: "sealed",
        seatCount: 2,
        packSource: "lea",
    });
}

describe("myLimitedEvents / myCurrentLimitedEvents read only the viewer's own events (issue #6076)", () => {
    it("never reads an event the viewer is not seated in, nor scans the event table", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const mine = await newEvent(db, "alice");
        const finished = await newEvent(db, "alice");
        const theirs = await newEvent(db, "bob");
        await join(as(db, "carol"), { eventId: theirs });
        const row = db.tables.limitedEvents.find((r) => r._id === finished)!;
        row.status = "finished";

        for (const [query, expected, memberKeys] of [
            [listAll, [mine, finished].sort(), [["alice"]]],
            [
                listCurrent,
                [mine],
                [
                    ["alice", true],
                    ["alice", undefined],
                ],
            ],
        ] as const) {
            db.reads.length = 0;
            db.gets.length = 0;
            const result = await query(as(db, "alice"), {});

            expect(result.map((e) => e._id).sort()).toEqual(expected);
            expect(db.gets).not.toContain(theirs);
            expect(db.reads.filter((r) => r.table === "limitedEvents")).toEqual(
                []
            );
            expect(
                db.reads.filter((r) => r.table === "limitedEventMembers")
            ).toEqual(
                memberKeys.map((key) => ({ table: "limitedEventMembers", key }))
            );
        }
    });

    it("a membership row with no matching Seat surfaces nothing", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const theirs = await newEvent(db, "bob");
        db.tables.limitedEventMembers.push({
            _id: "stale",
            userId: "alice",
            eventId: theirs,
        });

        expect(await listAll(as(db, "alice"), {})).toEqual([]);
    });
});

describe("limitedEventMembers follows who holds a Seat (issue #6076)", () => {
    it("join adds the row, leaving an open event removes it, re-joining is idempotent", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const eventId = await newEvent(db, "alice");
        // The creator is seated at creation, so already a member.
        expect(members(db)).toEqual([["alice", eventId]]);

        await join(as(db, "bob"), { eventId });
        expect(members(db)).toEqual([
            ["alice", eventId],
            ["bob", eventId],
        ]);

        await leave(as(db, "bob"), { eventId });
        expect(members(db)).toEqual([["alice", eventId]]);
    });

    it("seats the creator in the first Seat at creation, and they can leave (issue #9992)", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const eventId = await newEvent(db, "alice");
        const row = db.tables.limitedEvents.find((r) => r._id === eventId)!;
        const seats = row.seats as { userId?: string; isBot?: boolean }[];
        expect(seats[0]?.userId).toBe("alice");
        expect(seats.slice(1).every((s) => s.userId === undefined)).toBe(true);

        await leave(as(db, "alice"), { eventId });
        const after = db.tables.limitedEvents.find((r) => r._id === eventId)!;
        expect(
            (after.seats as { userId?: string }[]).some((s) => s.userId)
        ).toBe(false);
        expect(members(db)).toEqual([]);
    });

    it("saveSeats brings the index in step and writes nothing when no User moved", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const eventId = await newEvent(db, "alice");
        const seats = assignFreeSeat(buildEmptySeats(2), "carol", "Carol");

        await saveSeats(db.ctx, eventId, seats);
        expect(members(db)).toEqual([["carol", eventId]]);

        db.writes.length = 0;
        await saveSeats(db.ctx, eventId, seats);
        expect(
            db.writes.filter((w) => w.table === "limitedEventMembers")
        ).toEqual([]);
    });

    it("deleteSeats removes the event's rows with it", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const eventId = await newEvent(db, "alice");
        expect(members(db)).toEqual([["alice", eventId]]);

        await deleteSeats(db.ctx, eventId);
        expect(members(db)).toEqual([]);
    });

    it("migrateEventMembers backfills events written before the index, across pages", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const a = await newEvent(db, "alice");
        const b = await newEvent(db, "bob");
        db.tables.limitedEventMembers = [];

        let cursor: string | null = null;
        for (;;) {
            const page = await backfill(db.ctx, { cursor, limit: 1 });
            cursor = page.cursor;
            if (page.isDone) break;
        }
        expect(members(db)).toEqual(
            [
                ["alice", a],
                ["bob", b],
            ].sort() as [string, string][]
        );
    });
});

/** Puts `eventId` past seating, as `startLimitedEvent` would, so a creator's
 *  close force-finishes it instead of deleting it. */
function markStarted(db: InMemoryDb, eventId: string) {
    db.tables.limitedEvents.find((r) => r._id === eventId)!.status = "started";
}

/** The `limitedEvents` rows among `db.gets`, in read order. */
function eventGets(db: InMemoryDb): string[] {
    const ids = new Set(db.tables.limitedEvents.map((r) => r._id));
    return db.gets.filter((id) => ids.has(id));
}

describe("myCurrentLimitedEvents never reads a concluded event (issue #10903)", () => {
    it("with one live and three concluded events, reads exactly the live event row", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const live = await newEvent(db, "alice");
        for (let i = 0; i < 3; i++) {
            const done = await newEvent(db, "alice");
            markStarted(db, done);
            await cancel(as(db, "alice"), { eventId: done });
        }

        db.gets.length = 0;
        const result = await listCurrent(as(db, "alice"), {});

        expect(result.map((e) => e._id)).toEqual([live]);
        expect(eventGets(db)).toEqual([live]);
    });

    it("concluding an event flags its members inactive and drops it from the result; deleting an open one drops it too", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const started = await newEvent(db, "alice");
        await join(as(db, "bob"), { eventId: started });
        const open = await newEvent(db, "alice");
        markStarted(db, started);
        expect(
            (await listCurrent(as(db, "alice"), {})).map((e) => e._id).sort()
        ).toEqual([started, open].sort());

        await cancel(as(db, "alice"), { eventId: started });
        expect(
            db.tables.limitedEventMembers
                .filter((r) => r.eventId === started)
                .map((r) => r.active)
        ).toEqual([false, false]);
        expect(
            (await listCurrent(as(db, "alice"), {})).map((e) => e._id)
        ).toEqual([open]);
        expect(await listCurrent(as(db, "bob"), {})).toEqual([]);

        await cancel(as(db, "alice"), { eventId: open });
        expect(await listCurrent(as(db, "alice"), {})).toEqual([]);
    });

    it("rows written before the flag are read as unknown, and the backfill flags them idempotently", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const live = await newEvent(db, "alice");
        const done = await newEvent(db, "alice");
        markStarted(db, done);
        await cancel(as(db, "alice"), { eventId: done });
        for (const row of db.tables.limitedEventMembers) delete row.active;

        // Before the backfill: both rows unknown, both read, same answer.
        expect(
            (await listCurrent(as(db, "alice"), {})).map((e) => e._id)
        ).toEqual([live]);

        expect(await backfillActive(db.ctx, { limit: 1 })).toEqual({
            flagged: 1,
            remaining: 1,
        });
        expect(await backfillActive(db.ctx, {})).toEqual({
            flagged: 1,
            remaining: 0,
        });
        db.writes.length = 0;
        expect(await backfillActive(db.ctx, {})).toEqual({
            flagged: 0,
            remaining: 0,
        });
        expect(db.writes).toEqual([]);

        const flags = Object.fromEntries(
            db.tables.limitedEventMembers.map((r) => [r.eventId, r.active])
        );
        expect(flags).toEqual({ [live]: true, [done]: false });

        db.gets.length = 0;
        expect(
            (await listCurrent(as(db, "alice"), {})).map((e) => e._id)
        ).toEqual([live]);
        expect(eventGets(db)).toEqual([live]);
    });
});
