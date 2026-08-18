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
    internSeatRow,
    saveSeatPayload,
    saveSeats,
    saveSelection,
    seatRowNeedsInterning,
} from "../limitedSeatStore";
import { resolveCardMeta } from "../limitedCardMeta";
import { getAllCards, getPrintsForCard } from "../cards/catalogue";
import { startDraft } from "../limited/draftEngine";
import {
    buildCubePool,
    CUBE_PACK_SIZE,
    CUBE_SOURCE_KEY,
} from "../limited/cube";

// --- In-memory db ------------------------------------------------------------

type Row = InMemoryRow;

/** The shared in-memory ctx (`fixtures/inMemoryDb.ts`), plus the two accessors
 *  this file's assertions are written against. */
function makeDb(initial: Record<string, Row[]>) {
    const { ctx, tables, writes, reads } = makeInMemoryDb(initial);
    return {
        ctx,
        tables,
        writes,
        reads,
        seatRows: () => tables.limitedSeats ?? [],
        event: () => tables.limitedEvents[0] as unknown as Doc<"limitedEvents">,
    };
}

// --- Fixtures ----------------------------------------------------------------

/** `sf-N` resolves to NOTHING in the card registry, and that is deliberate:
 *  since the card payload is interned (issue #2507) a stored card is only its
 *  `scryfallId`, so what a seat hydrates back to is whatever
 *  `convex/limitedCardMeta.ts` resolves — and for an unresolvable id that is
 *  the producers' own fallback, `cardId === cardName === scryfallId`
 *  (`meta?.cardId ?? drawn.scryfallId` in `generateSealedPools` /
 *  `generateRoundPacks`). Writing the fixture in that shape keeps every
 *  round-trip assertion below an exact identity AND makes the whole file
 *  exercise the fail-closed path. Resolution of a REAL registry id, and the
 *  legacy rows that still store their own pair, get their own block at the
 *  bottom of this file. */
function card(n: number): LimitedPoolCard {
    return {
        scryfallId: `sf-${n}`,
        cardId: `sf-${n}`,
        cardName: `sf-${n}`,
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
    // Child rows carry the INTERNED shape (issue #2507) — `scryfallId` only,
    // plus `pickId` on a pack card. That is what the store writes, so a
    // fixture in the pre-intern shape would make every dirty-check assertion
    // below measure the backfill's read-repair instead of the dirty check.
    const seatRows: Row[] = inline
        ? []
        : seats.map((seat, i) => ({
              _id: `limitedSeats-${i}`,
              eventId: "event-1",
              seatIndex: seat.seatIndex,
              ...(seat.pool
                  ? {
                        pool: seat.pool.map((c) => ({
                            scryfallId: c.scryfallId,
                        })),
                    }
                  : {}),
              ...(seat.currentPack
                  ? {
                        currentPack: seat.currentPack.map((c) => ({
                            scryfallId: c.scryfallId,
                            pickId: c.pickId,
                        })),
                    }
                  : {}),
          }));
    const db = makeDb({
        limitedEvents: [eventRow],
        limitedSeats: seatRows,
        limitedSelections: [],
    });
    return {
        ...db,
        seats,
        selectionRows: () => db.tables.limitedSelections ?? [],
    };
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

    it("deleteSeats drops every payload row of the event", async () => {
        const { ctx, seatRows } = makeFixture();
        await deleteSeats(ctx, EVENT_ID);
        expect(seatRows()).toHaveLength(0);
    });

    it("deleteSeats drops the selection rows too", async () => {
        const { ctx, selectionRows } = makeFixture();
        await saveSelection(ctx, EVENT_ID, 0, "r0-p0-c0");
        await deleteSeats(ctx, EVENT_ID);
        expect(selectionRows()).toHaveLength(0);
    });
});

// The `limitedSelections` split (`convex/schema.ts`): a Selected Card is
// private to its own seat and fires at click cadence, so it must cost one
// small row of its own and leave the shared event document alone. Every way
// this can go wrong is silent — a selection that survives its own clear, a
// click that still writes the event row, a seat reading another seat's pick.
describe("limitedSeatStore — Selected Card", () => {
    it("a selection writes its own row and never the event row", async () => {
        const { ctx, event, writes } = makeFixture();
        writes.length = 0;
        await saveSelection(ctx, EVENT_ID, 0, "r0-p0-c0");

        expect(writes.map((w) => w.table)).toEqual(["limitedSelections"]);
        expect(await hydrateSeats(ctx, event(), [0])).toMatchObject([
            { selectedPickId: "r0-p0-c0" },
            {},
        ]);
    });

    it("clearing deletes the row, and the clear STICKS across a pick", async () => {
        // The resurrect bug this guards: a hydrated seat carries the value
        // read from the selection row, so a save that wrote it back onto the
        // event row would leave an inline copy that out-lives the delete and
        // silently re-selects a card the player cancelled.
        const { ctx, event, selectionRows } = makeFixture();
        await saveSelection(ctx, EVENT_ID, 0, "r0-p0-c0");
        const hydrated = await hydrateSeats(ctx, event());
        await saveSeats(ctx, EVENT_ID, hydrated, { updatedAt: 9 });
        expect(event().seats[0].selectedPickId).toBeUndefined();

        await saveSelection(ctx, EVENT_ID, 0, null);
        expect(selectionRows()).toHaveLength(0);
        expect(
            (await hydrateSeats(ctx, event()))[0].selectedPickId
        ).toBeUndefined();
    });

    it("a narrowed hydration reads only its own seat's selection", async () => {
        // Not a byte count — a READ SET. If seat 0's hydration touched seat
        // 1's row, every seat's subscription would re-execute on every other
        // seat's click, which is the cost the split removes.
        const { ctx, event, reads } = makeFixture();
        await saveSelection(ctx, EVENT_ID, 1, "r0-p1-c0");
        reads.length = 0;
        const hydrated = await hydrateSeats(ctx, event(), [0]);

        expect(hydrated[0].selectedPickId).toBeUndefined();
        expect(hydrated[1].selectedPickId).toBeUndefined();
        expect(reads.filter((r) => r.table === "limitedSelections")).toEqual([
            { table: "limitedSelections", key: [EVENT_ID, 0] },
        ]);
    });

    it("prefers the selection row over a legacy inline copy", async () => {
        const { ctx, event } = makeFixture({ inline: true });
        await ctx.db.patch(EVENT_ID, {
            seats: event().seats.map((seat, i) =>
                i === 0 ? { ...seat, selectedPickId: "stale" } : seat
            ),
        });
        expect((await hydrateSeats(ctx, event()))[0].selectedPickId).toBe(
            "stale"
        );

        await saveSelection(ctx, EVENT_ID, 0, "r0-p0-c0");
        expect((await hydrateSeats(ctx, event()))[0].selectedPickId).toBe(
            "r0-p0-c0"
        );
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

    it("a single-seat payload write on a LEGACY event does not delete the Pools", async () => {
        // The regression this guards: the slim write helpers strip the payload
        // keys unconditionally, so without the `ensureSeatsMigrated`
        // precondition a single-seat edit would rewrite an un-migrated event's
        // seats with every OTHER seat's cards simply gone.
        const { ctx, event, seats } = makeFixture({ inline: true });

        await saveSeatPayload(ctx, event(), 0, {
            poolArrangement: [{ poolIndex: 1, sideboard: true }],
        });

        expect(await hydrateSeats(ctx, event())).toEqual(
            withCounts(seats).map((s, i) =>
                i === 0
                    ? {
                          ...s,
                          poolArrangement: [{ poolIndex: 1, sideboard: true }],
                      }
                    : s
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

// --- Card payload interning (issue #2507) ------------------------------------

/** `count` real registry ids, as PRINT ids where the definition has one — the
 *  shape a Booster actually draws (`generateBooster` yields printings, and
 *  `printById` aliases each into the registry so `resolveCardMeta` maps it
 *  back to the canonical `cardId`). Taken from the live catalogue rather than
 *  hard-coded so this cannot rot against a card being renamed or re-set. */
function realScryfallIds(count: number): string[] {
    const ids: string[] = [];
    for (const def of getAllCards()) {
        if (ids.length >= count) break;
        ids.push(getPrintsForCard(def.id)[0] ?? def.id);
    }
    if (ids.length < count) {
        throw new Error(`catalogue has fewer than ${count} cards`);
    }
    return ids;
}

/** `count` Pool cards in the shape `generateSealedPools` writes them. */
function realPoolCards(count: number): LimitedPoolCard[] {
    return realScryfallIds(count).map((id) => {
        const { pickId, ...rest } = producerPackCard(id, "unused");
        void pickId;
        return rest;
    });
}

/** A pack card exactly as the three producers write one — `generateRoundPacks`
 *  / `generateCubeRoundPacks` (`convex/limited/draftEngine.ts`) and, minus the
 *  `pickId`, `generateSealedPools` (`convex/limited/eventLogic.ts`). Spelled
 *  out here rather than imported so these tests are written from the producer
 *  census, not from the seam's own expansion. */
function producerPackCard(scryfallId: string, pickId: string) {
    const meta = resolveCardMeta(scryfallId);
    return {
        scryfallId,
        cardId: meta?.cardId ?? scryfallId,
        cardName: meta?.cardName ?? scryfallId,
        pickId,
    };
}

function emptyEventFixture() {
    const eventRow: Row = {
        _id: "event-1",
        createdBy: "alice",
        type: "draft",
        status: "started",
        seatCount: 1,
        packSlots: ["lea"],
        createdAt: 1,
        updatedAt: 1,
        seats: [{ seatIndex: 0, userId: "alice" }],
    };
    return makeDb({
        limitedEvents: [eventRow],
        limitedSeats: [],
        limitedSelections: [],
    });
}

describe("limitedSeatStore — card payload interning (issue #2507)", () => {
    it("stores only scryfallId (+ pickId), never the derived pair", async () => {
        const { ctx, seatRows } = emptyEventFixture();
        const ids = realScryfallIds(3);
        await saveSeats(ctx, EVENT_ID, [
            {
                seatIndex: 0,
                userId: "alice",
                pool: [producerPackCard(ids[0], "x")].map(
                    ({ pickId, ...rest }) => {
                        void pickId;
                        return rest;
                    }
                ),
                currentPack: [producerPackCard(ids[1], "r0-p0-c0")],
                packQueue: [[producerPackCard(ids[2], "r0-p1-c0")]],
            },
        ]);

        const stored = seatRows()[0];
        const cards = [
            ...(stored.pool as object[]),
            ...(stored.currentPack as object[]),
            ...(stored.packQueue as object[][]).flat(),
        ];
        for (const c of cards) {
            expect(Object.keys(c).sort()).not.toContain("cardId");
            expect(Object.keys(c).sort()).not.toContain("cardName");
        }
        expect(stored.pool).toEqual([{ scryfallId: ids[0] }]);
        expect(stored.currentPack).toEqual([
            { scryfallId: ids[1], pickId: "r0-p0-c0" },
        ]);
        expect(stored.packQueue).toEqual([
            [{ scryfallId: ids[2], pickId: "r0-p1-c0" }],
        ]);
    });

    it("expands EVERY queued pack, resolvable and not, pickIds intact", async () => {
        // `packQueue` is the array that is easiest to leave unexpanded and
        // worst to leave unexpanded. A queued pack is dequeued into
        // `currentPack`, and `applyPick` (`convex/limited/draftEngine.ts`)
        // copies the trio card-for-card into `pool` — so an unexpanded entry
        // lands in the Pool carrying `cardId: undefined`, and
        // `poolFromLimitedPoolCards` (`convex/limited/poolResolution.ts`)
        // dedups the Pool multiset BY `cardId`: every card in the seat would
        // collapse onto that one key. Two packs, so the nesting is exercised,
        // and one card the registry cannot resolve, so the producers' own
        // fallback identity is asserted through the queue too.
        const { ctx, event } = emptyEventFixture();
        const ids = realScryfallIds(2);
        const missing = "no-such-scryfall-id";
        expect(resolveCardMeta(missing)).toBeNull();
        const queue = [
            [
                producerPackCard(ids[0], "r1-p0-c0"),
                producerPackCard(missing, "r1-p0-c1"),
            ],
            [producerPackCard(ids[1], "r2-p0-c0")],
        ];
        // Guards the guard: a fixture whose "real" ids resolved to nothing
        // would assert only the fallback branch, where `cardName` is the id.
        expect(queue[0][0].cardName).not.toBe(ids[0]);
        expect(queue[1][0].cardName).not.toBe(ids[1]);

        await saveSeats(ctx, EVENT_ID, [
            { seatIndex: 0, userId: "alice", packQueue: queue },
        ]);
        const [seat] = await hydrateSeats(ctx, event());
        expect(seat.packQueue).toEqual(queue);
    });

    it("hydrates a real Scryfall id back to its resolved cardId and name", async () => {
        const { ctx, event } = emptyEventFixture();
        const [id] = realScryfallIds(1);
        const expected = producerPackCard(id, "r0-p0-c0");
        // Guards the guard: a fixture id that resolved to NOTHING would make
        // this test pass vacuously against the fallback branch, where
        // `cardName` is the id itself. (`cardId` is not the tell — a card's
        // home printing legitimately has `printId === definitionId`.)
        expect(expected.cardName).not.toBe(id);
        expect(expected.cardName.length).toBeGreaterThan(0);

        await saveSeats(ctx, EVENT_ID, [
            { seatIndex: 0, userId: "alice", currentPack: [expected] },
        ]);
        const [seat] = await hydrateSeats(ctx, event());
        expect(seat.currentPack).toEqual([expected]);
    });

    it("keeps an UNRESOLVABLE card, with the producer's own fallback identity", async () => {
        // The failure this exists to prevent: an id the registry cannot
        // resolve must not drop out of the Pool, become null, or acquire a
        // sentinel. `poolFromLimitedPoolCards` dedups the Pool multiset by
        // `cardId`, so a card whose id changed between write and read would
        // corrupt the pool rather than merely look wrong.
        const { ctx, event } = emptyEventFixture();
        const missing = "no-such-scryfall-id";
        expect(resolveCardMeta(missing)).toBeNull();
        const asProducerWroteIt = {
            scryfallId: missing,
            cardId: missing,
            cardName: missing,
        };

        await saveSeats(ctx, EVENT_ID, [
            {
                seatIndex: 0,
                userId: "alice",
                pool: [asProducerWroteIt, ...realPoolCards(1)],
            },
        ]);
        const [seat] = await hydrateSeats(ctx, event());
        expect(seat.pool).toHaveLength(2);
        expect(seat.pool?.[0]).toEqual(asProducerWroteIt);
    });

    it("round-trips a REAL dealt cube round byte-identically", async () => {
        // The determinism guarantee (ADR 0062) at the persistence layer: what
        // the engine dealt is what a later hydration reads, card for card,
        // field for field. Driven through the real `startDraft` and the real
        // `resolveCardMeta`, so nothing here is a transcription of the seam's
        // own expansion — the pack cards come from the same code path a live
        // draft's do.
        const { ctx, event } = emptyEventFixture();
        const dealt = startDraft(
            [{ seatIndex: 0, userId: "alice" }],
            [CUBE_SOURCE_KEY],
            4242,
            () => null,
            resolveCardMeta,
            undefined,
            buildCubePool()
        );
        const pack = dealt.seats[0].currentPack;
        const before = structuredClone(pack);
        expect(before).toHaveLength(CUBE_PACK_SIZE);

        await saveSeats(ctx, EVENT_ID, [
            { seatIndex: 0, userId: "alice", currentPack: pack },
        ]);
        const [seat] = await hydrateSeats(ctx, event());
        expect(seat.currentPack).toEqual(before);
    });
});

describe("limitedSeatStore — intern backfill (issue #2507)", () => {
    /** One seat row in the PRE-intern shape: cards carrying the derived pair
     *  the intern removed. */
    function legacyFixture() {
        const pack = [producerPackCard(realScryfallIds(2)[1], "r0-p0-c0")];
        const poolCards = realPoolCards(1);
        const eventRow: Row = {
            _id: "event-1",
            createdBy: "alice",
            type: "draft",
            status: "started",
            seatCount: 1,
            packSlots: ["lea"],
            createdAt: 1,
            updatedAt: 1,
            seats: [{ seatIndex: 0, userId: "alice", poolCount: 1 }],
        };
        const db = makeDb({
            limitedEvents: [eventRow],
            limitedSeats: [
                {
                    _id: "limitedSeats-0",
                    eventId: "event-1",
                    seatIndex: 0,
                    pool: structuredClone(poolCards),
                    currentPack: structuredClone(pack),
                    poolArrangement: [{ poolIndex: 0, sideboard: true }],
                },
            ],
            limitedSelections: [],
        });
        return { ...db, pack, poolCards };
    }

    it("reads a legacy row's OWN cardId/cardName in preference to a resolve", async () => {
        const { ctx, event, tables } = legacyFixture();
        // Rewrite the stored pair to something the registry would never
        // produce: if the seam re-resolved instead of trusting the row, an
        // in-flight draft's card identities would shift under it.
        (
            tables.limitedSeats[0].pool as {
                cardId: string;
                cardName: string;
            }[]
        )[0].cardId = "legacy-id";
        (
            tables.limitedSeats[0].pool as {
                cardId: string;
                cardName: string;
            }[]
        )[0].cardName = "Legacy Name";

        const [seat] = await hydrateSeats(ctx, event());
        expect(seat.pool?.[0].cardId).toBe("legacy-id");
        expect(seat.pool?.[0].cardName).toBe("Legacy Name");
    });

    it("interns a legacy row and leaves everything else untouched", async () => {
        const { ctx, seatRows, pack, poolCards } = legacyFixture();
        const row = seatRows()[0] as unknown as Doc<"limitedSeats">;
        expect(seatRowNeedsInterning(row)).toBe(true);

        await internSeatRow(ctx, row);

        const after = seatRows()[0];
        expect(after.pool).toEqual([{ scryfallId: poolCards[0].scryfallId }]);
        expect(after.currentPack).toEqual([
            { scryfallId: pack[0].scryfallId, pickId: pack[0].pickId },
        ]);
        // Pool Arrangement keys on `poolIndex`, never on card identity — it
        // must survive the intern verbatim.
        expect(after.poolArrangement).toEqual([
            { poolIndex: 0, sideboard: true },
        ]);
    });

    it("is idempotent: a second pass selects nothing and writes nothing", async () => {
        // `migrateSeatCardPayload` (`convex/limitedEvents.ts`) is exactly this
        // loop over `ctx.db.query("limitedSeats").take(n)`.
        const { ctx, seatRows, writes } = legacyFixture();
        const runPass = async () => {
            let migrated = 0;
            for (const row of seatRows()) {
                const doc = row as unknown as Doc<"limitedSeats">;
                if (!seatRowNeedsInterning(doc)) continue;
                await internSeatRow(ctx, doc);
                migrated++;
            }
            return migrated;
        };

        expect(await runPass()).toBe(1);
        const afterFirst = structuredClone(seatRows()[0]);
        const writesAfterFirst = writes.length;

        expect(await runPass()).toBe(0);
        expect(writes.length).toBe(writesAfterFirst);
        expect(seatRows()[0]).toEqual(afterFirst);
    });

    it("saveSeatPayload interns the patch AND the keys it left alone", async () => {
        // The single-seat write path merges its patch over the row's EXPANDED
        // payload, then interns the whole thing. Both halves matter: the patch
        // arrives in the hydrated (`LimitedEventSeat`) shape, so a raw merge
        // would store its fat cards verbatim, and the keys the patch does not
        // mention would stay fat forever on a legacy row — the one write path
        // that never read-repairs.
        const { ctx, event, seatRows, pack } = legacyFixture();
        const patched = realPoolCards(2);
        expect(patched[0].cardName).not.toBe(patched[0].scryfallId);

        await saveSeatPayload(ctx, event(), 0, { pool: patched });

        const after = seatRows()[0];
        expect(after.pool).toEqual(
            patched.map((c) => ({ scryfallId: c.scryfallId }))
        );
        expect(after.currentPack).toEqual([
            { scryfallId: pack[0].scryfallId, pickId: pack[0].pickId },
        ]);
        expect(
            seatRowNeedsInterning(
                seatRows()[0] as unknown as Doc<"limitedSeats">
            )
        ).toBe(false);
    });

    it("read-repairs a legacy row on the next ordinary save", async () => {
        // The lazy half of the backfill: any event still being written to
        // slims itself, and then stops rewriting (the dirty check holds).
        const { ctx, event, seatRows, writes } = legacyFixture();
        const hydrated = await hydrateSeats(ctx, event());

        await saveSeats(ctx, EVENT_ID, hydrated);
        expect(
            seatRowNeedsInterning(
                seatRows()[0] as unknown as Doc<"limitedSeats">
            )
        ).toBe(false);
        const seatWrites = writes.filter((w) => w.table === "limitedSeats");
        expect(seatWrites).toHaveLength(1);

        await saveSeats(ctx, EVENT_ID, await hydrateSeats(ctx, event()));
        expect(writes.filter((w) => w.table === "limitedSeats")).toHaveLength(
            1
        );
    });
});
