// `limitedSeats` split (`convex/schema.ts`, `convex/limitedSeatStore.ts`): the
// per-seat card payload lives in its own table so listing events never reads
// it. The store is the ONLY module that knows this, which makes it the only
// place the split can go wrong — and the ways it can go wrong are all silent
// (a Pool that reads as empty, a Pool overwritten by a slim write, a
// `poolCount` that drifts from the Pool it counts), never an exception.
//
// The project has no convex-test harness (see `convex/__tests__/decks.test.ts`)
// so this drives the real store against the shared minimal in-memory `db`
// (`fixtures/inMemoryDb.ts`), which implements exactly the surface the store
// uses: `get`/`patch`/`insert`/`replace`/`delete` plus
// `query(table).withIndex(name, q => q.eq(...)).unique()/.collect()`.
import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { LimitedEventSeat, LimitedPoolCard } from "../limited/eventTypes";
import { makeInMemoryDb, type InMemoryRow } from "./fixtures/inMemoryDb";
import { projectLimitedEvent } from "../limited/eventProjection";
import {
    deleteSeats,
    ensureSeatsMigrated,
    eventHasInlinePayload,
    hydrateSeats,
    saveSeatPayload,
    saveSeats,
    saveSlimSeats,
} from "../limitedSeatStore";

// --- In-memory db ------------------------------------------------------------

type Row = InMemoryRow;

/** The shared in-memory ctx (`fixtures/inMemoryDb.ts`), plus the two accessors
 *  this file's assertions are written against. */
function makeDb(initial: Record<string, Row[]>) {
    const { ctx, tables, writes } = makeInMemoryDb(initial);
    return {
        ctx,
        tables,
        writes,
        seatRows: () => tables.limitedSeats ?? [],
        event: () => tables.limitedEvents[0] as unknown as Doc<"limitedEvents">,
    };
}

// --- Fixtures ----------------------------------------------------------------

function card(n: number): LimitedPoolCard {
    return {
        scryfallId: `sf-${n}`,
        cardId: `card-${n}`,
        cardName: `Card ${n}`,
    };
}

function pool(from: number, count: number): LimitedPoolCard[] {
    return Array.from({ length: count }, (_, i) => card(from + i));
}

/** Two seats, each with a Pool and a current pack — the shape a started Draft
 *  has. `inline` places the payload on the event row (the legacy pre-split
 *  shape) instead of in `limitedSeats`. */
function makeFixture({ inline = false }: { inline?: boolean } = {}) {
    const seats: LimitedEventSeat[] = [
        {
            seatIndex: 0,
            userId: "alice",
            nickname: "Alice",
            pickSeq: 3,
            pool: pool(1, 4),
            currentPack: [{ ...card(90), pickId: "r0-p0-c0" }],
        },
        {
            seatIndex: 1,
            isBot: true,
            pool: pool(50, 2),
        },
    ];
    const eventRow: Row = {
        _id: "event-1",
        createdBy: "alice",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea"],
        createdAt: 1,
        updatedAt: 1,
        seats: inline
            ? structuredClone(seats)
            : seats.map((seat) => {
                  const { pool: seatPool, currentPack, ...slim } = seat;
                  void currentPack;
                  return {
                      ...slim,
                      poolCount: seatPool?.length,
                  } as unknown as Row;
              }),
    };
    const seatRows: Row[] = inline
        ? []
        : seats.map((seat, i) => ({
              _id: `limitedSeats-${i}`,
              eventId: "event-1",
              seatIndex: seat.seatIndex,
              ...(seat.pool ? { pool: seat.pool } : {}),
              ...(seat.currentPack ? { currentPack: seat.currentPack } : {}),
          }));
    const db = makeDb({
        limitedEvents: [eventRow],
        limitedSeats: seatRows,
    });
    return { ...db, seats };
}

const EVENT_ID = "event-1" as Id<"limitedEvents">;

/** The fixture seats as a hydration returns them: identical, plus the
 *  `poolCount` the event row carries alongside every stored Pool. Stated once
 *  here so the round-trip assertions compare against the real stored shape
 *  rather than quietly dropping the denormalised field. */
function withCounts(seats: LimitedEventSeat[]): LimitedEventSeat[] {
    return seats.map((seat) =>
        seat.pool ? { ...seat, poolCount: seat.pool.length } : seat
    );
}

// --- Tests -------------------------------------------------------------------

describe("limitedSeatStore — hydration", () => {
    it("reassembles the full seat array from the child rows", async () => {
        const { ctx, event, seats } = makeFixture();
        expect(await hydrateSeats(ctx, event())).toEqual(withCounts(seats));
    });

    it("hydrates ONLY the requested seats, leaving the rest slim", async () => {
        const { ctx, event } = makeFixture();
        const hydrated = await hydrateSeats(ctx, event(), [0]);

        expect(hydrated[0].pool).toHaveLength(4);
        expect(hydrated[0].currentPack).toHaveLength(1);
        // The un-requested seat carries no card data — the whole point of a
        // narrowed load, and what keeps a draft-board read off the other
        // seats' Pools.
        expect(hydrated[1].pool).toBeUndefined();
        // …but keeps its identity and its denormalised count, so a projection
        // can still report "seat 1 has 2 cards" without reading them.
        expect(hydrated[1].isBot).toBe(true);
        expect(hydrated[1].poolCount).toBe(2);
    });

    it("folds in a LEGACY row's inline payload when no child row exists", async () => {
        const { ctx, event, seats, seatRows } = makeFixture({ inline: true });
        expect(seatRows()).toHaveLength(0);
        expect(eventHasInlinePayload(event())).toBe(true);
        expect(await hydrateSeats(ctx, event())).toEqual(seats);
    });

    it("strips a LEGACY row's inline payload for un-requested seats", async () => {
        // Otherwise a narrowed hydration would behave differently on migrated
        // and un-migrated rows — leaking another seat's Pool into a projection
        // written on the assumption it isn't loaded.
        const { ctx, event } = makeFixture({ inline: true });
        const hydrated = await hydrateSeats(ctx, event(), [0]);
        expect(hydrated[0].pool).toHaveLength(4);
        expect(hydrated[1].pool).toBeUndefined();
    });
});

describe("limitedSeatStore — writes", () => {
    it("round-trips: what saveSeats writes, hydrateSeats reads back", async () => {
        const { ctx, event, seats } = makeFixture();
        const next = structuredClone(seats);
        next[0].pool!.push(card(99));
        next[0].currentPack = [];

        await saveSeats(ctx, EVENT_ID, next, { updatedAt: 2 });
        expect(await hydrateSeats(ctx, event())).toEqual(withCounts(next));
        expect(event().updatedAt).toBe(2);
    });

    it("keeps the card payload OFF the event row", async () => {
        const { ctx, event, seats } = makeFixture();
        await saveSeats(ctx, EVENT_ID, structuredClone(seats));
        for (const seat of event().seats) {
            expect(seat.pool).toBeUndefined();
            expect(seat.currentPack).toBeUndefined();
            expect(seat.packQueue).toBeUndefined();
        }
    });

    it("re-derives poolCount so the slim row can never drift from the Pool", async () => {
        const { ctx, event, seats } = makeFixture();
        const next = structuredClone(seats);
        next[0].pool!.push(card(99), card(98));
        // A caller that never touches `poolCount` (every caller — the pure
        // engine doesn't know the field exists) must still end up with a
        // correct one.
        await saveSeats(ctx, EVENT_ID, next);
        expect(event().seats[0].poolCount).toBe(6);
    });

    it("rewrites ONLY the seats whose payload actually changed", async () => {
        const { ctx, event, seats, writes } = makeFixture();
        const next = structuredClone(seats);
        next[0].pool!.push(card(99));

        writes.length = 0;
        await saveSeats(ctx, EVENT_ID, next);

        const seatWrites = writes.filter((w) => w.table === "limitedSeats");
        expect(seatWrites).toHaveLength(1);
        expect(seatWrites[0].id).toBe("limitedSeats-0");
        // Seat 1 was untouched — a Pick must not rewrite every seat's cards.
        expect(event().seats[1].poolCount).toBe(2);
    });

    it("makes a field going ABSENT actually disappear", async () => {
        // `currentPack` clearing when a seat's pack empties is a real draft
        // transition, and a `patch` with an absent key would silently keep the
        // old pack — the seat would look like it still holds cards to pick.
        const { ctx, event, seats } = makeFixture();
        const next = structuredClone(seats);
        delete next[0].currentPack;

        await saveSeats(ctx, EVENT_ID, next);
        const hydrated = await hydrateSeats(ctx, event());
        expect(hydrated[0].currentPack).toBeUndefined();
    });

    it("saveSeatPayload merges one seat's field without touching its Pool", async () => {
        const { ctx, event, writes } = makeFixture();
        writes.length = 0;
        await saveSeatPayload(
            ctx,
            event(),
            0,
            { poolArrangement: [{ poolIndex: 1, sideboard: true }] },
            { updatedAt: 7 }
        );

        const hydrated = await hydrateSeats(ctx, event());
        expect(hydrated[0].poolArrangement).toEqual([
            { poolIndex: 1, sideboard: true },
        ]);
        expect(hydrated[0].pool).toHaveLength(4);
        expect(event().updatedAt).toBe(7);
        // Only the edited seat's row was written.
        expect(
            writes.filter((w) => w.table === "limitedSeats").map((w) => w.id)
        ).toEqual(["limitedSeats-0"]);
    });

    it("saveSlimSeats writes the event row without touching any payload row", async () => {
        const { ctx, event, writes } = makeFixture();
        const seats = await hydrateSeats(ctx, event(), [0]);
        seats[0] = { ...seats[0], selectedPickId: "r0-p0-c0" };

        writes.length = 0;
        await saveSlimSeats(ctx, event(), seats, { updatedAt: 5 });

        expect(writes.filter((w) => w.table === "limitedSeats")).toHaveLength(
            0
        );
        expect(event().seats[0].selectedPickId).toBe("r0-p0-c0");
        // …and the narrowly-hydrated seat 1 did NOT lose its Pool.
        const hydrated = await hydrateSeats(ctx, event());
        expect(hydrated[1].pool).toHaveLength(2);
        expect(hydrated[0].pool).toHaveLength(4);
    });

    it("deleteSeats drops every payload row of the event", async () => {
        const { ctx, seatRows } = makeFixture();
        await deleteSeats(ctx, EVENT_ID);
        expect(seatRows()).toHaveLength(0);
    });
});

describe("limitedSeatStore — legacy migration", () => {
    it("moves inline payload into child rows and strips it, losing nothing", async () => {
        const { ctx, event, seats, seatRows } = makeFixture({ inline: true });
        await ensureSeatsMigrated(ctx, event());

        expect(eventHasInlinePayload(event())).toBe(false);
        expect(seatRows()).toHaveLength(2);
        expect(await hydrateSeats(ctx, event())).toEqual(withCounts(seats));
        expect(event().seats[0].poolCount).toBe(4);
        expect(event().seats[1].poolCount).toBe(2);
    });

    it("is idempotent and writes nothing on an already-split event", async () => {
        const { ctx, event, writes } = makeFixture();
        writes.length = 0;
        await ensureSeatsMigrated(ctx, event());
        expect(writes).toHaveLength(0);
    });

    it("a slim write on a LEGACY event does not delete the Pools", async () => {
        // The regression this guards: `saveSlimSeats` strips the payload keys
        // unconditionally, so without the migration precondition it would
        // rewrite an un-migrated event's seats with the cards simply gone.
        const { ctx, event, seats } = makeFixture({ inline: true });
        const narrow = await hydrateSeats(ctx, event(), [0]);
        narrow[0] = { ...narrow[0], selectedPickId: "r0-p0-c0" };

        await saveSlimSeats(ctx, event(), narrow);

        expect(await hydrateSeats(ctx, event())).toEqual(
            withCounts(seats).map((s, i) =>
                i === 0 ? { ...s, selectedPickId: "r0-p0-c0" } : s
            )
        );
    });
});

describe("limitedSeatStore — projection agreement", () => {
    it("projects a non-hydrated seat's poolCount from the slim row", async () => {
        // The list queries read `poolCount` INSTEAD of the Pool. If the
        // projection only ever derived it from `pool.length`, every seat a
        // caller deliberately didn't load would report `null` — a wrong number
        // on screen, with every server-side test still green.
        const { ctx, event } = makeFixture();
        const narrow = await hydrateSeats(ctx, event(), [0]);
        const projected = projectLimitedEvent(
            { ...(event() as unknown as object), seats: narrow } as Parameters<
                typeof projectLimitedEvent
            >[0],
            "alice"
        );

        expect(projected.seats[0].poolCount).toBe(4);
        expect(projected.seats[1].poolCount).toBe(2);
        // The privacy strip is unchanged: another seat's cards are still null.
        expect(projected.seats[1].pool).toBeNull();
    });
});
