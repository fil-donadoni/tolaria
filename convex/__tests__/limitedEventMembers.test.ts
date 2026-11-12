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
        await join(as(db, "alice"), { eventId: mine });
        await join(as(db, "alice"), { eventId: finished });
        await join(as(db, "bob"), { eventId: theirs });
        await join(as(db, "carol"), { eventId: theirs });
        const row = db.tables.limitedEvents.find((r) => r._id === finished)!;
        row.status = "finished";

        for (const [query, expected] of [
            [listAll, [mine, finished].sort()],
            [listCurrent, [mine]],
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
            ).toEqual([{ table: "limitedEventMembers", key: ["alice"] }]);
        }
    });

    it("a membership row with no matching Seat surfaces nothing", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const theirs = await newEvent(db, "bob");
        await join(as(db, "bob"), { eventId: theirs });
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
        expect(members(db)).toEqual([]);

        await join(as(db, "alice"), { eventId });
        await join(as(db, "bob"), { eventId });
        expect(members(db)).toEqual([
            ["alice", eventId],
            ["bob", eventId],
        ]);

        await leave(as(db, "bob"), { eventId });
        expect(members(db)).toEqual([["alice", eventId]]);
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
        await join(as(db, "alice"), { eventId });

        await deleteSeats(db.ctx, eventId);
        expect(members(db)).toEqual([]);
    });

    it("migrateEventMembers backfills events written before the index, across pages", async () => {
        const db = makeInMemoryDb({ users: USERS });
        const a = await newEvent(db, "alice");
        const b = await newEvent(db, "bob");
        await join(as(db, "alice"), { eventId: a });
        await join(as(db, "bob"), { eventId: b });
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
