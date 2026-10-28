// Deck Pool (ADR 0106): a `limited` deck carries its own Pool. Every save
// copies the Seat's Pool into the `limitedDeckPools` companion (skipped when
// identical), and `listMine` judges the deck against that copy alone — so the
// deck stays legal after its event and seat are gone. `migrateDeckPools`
// backfills legacy decks and reports the unrecoverable ones. Handlers driven
// for real against the shared in-memory ctx (no convex-test harness, see
// `deckDefinitionIdWrite.test.ts`).
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import { resolveDeckCardMeta } from "../cards";
import {
    create,
    listMine,
    migrateDeckPools,
    remove,
    update,
} from "../userDecks";
import {
    makeInMemoryDb,
    type InMemoryRow,
} from "./fixtures/inMemoryDb.fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

const ALICE = "user-alice";
const BOLT_PRINT = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const MOUNTAIN = "eace2c85-976c-425e-9800-5a6ccbd91b56";
const BOLT_ID = resolveDeckCardMeta(BOLT_PRINT)!.cardId;
const BOLT = { cardId: BOLT_PRINT, cardName: "Lightning Bolt" };
const POOL_BOLT = {
    scryfallId: BOLT_PRINT,
    cardId: BOLT_ID,
    cardName: "Lightning Bolt",
};

// One seat, `started`: `openPlayPhaseIfReady` (run by every Limited deck
// create) no-ops on a table below `MIN_SEATS`.
function sealedEvent(_id: string): InMemoryRow {
    return {
        _id,
        type: "sealed",
        status: "started",
        packSlots: ["lea"],
        seats: [{ seatIndex: 0, userId: ALICE, displayName: "Alice" }],
    };
}

function seatRow(eventId: string, pool: unknown[]): InMemoryRow {
    return { _id: `seat-${eventId}`, eventId, seatIndex: 0, pool };
}

// 40 main (one Bolt + basics, which the Pool never constrains) and the
// second pooled Bolt in the sideboard: the whole Pool travels with the deck.
function limitedDeck(eventId: string) {
    return {
        name: "Sealed LEA",
        format: "limited",
        colors: ["R"],
        cards: [
            BOLT,
            ...Array.from({ length: 39 }, () => ({
                cardId: MOUNTAIN,
                cardName: "Mountain",
            })),
        ],
        sideboard: [BOLT],
        limitedEventId: eventId,
        limitedSeatId: "0",
    };
}

function world() {
    return makeInMemoryDb(
        {
            users: [{ _id: ALICE, nickname: "Alice" }],
            limitedEvents: [sealedEvent("event-1")],
            limitedSeats: [seatRow("event-1", [POOL_BOLT, POOL_BOLT])],
        },
        { identitySubject: `${ALICE}|session` }
    );
}

const deckPoolWrites = (writes: { table: string }[]) =>
    writes.filter((w) => w.table === "limitedDeckPools").length;

describe("Deck Pool — written on save, skipped when identical (ADR 0106 §1)", () => {
    it("create copies the Seat's Pool into the companion, never onto the deck row", async () => {
        const { ctx, tables } = world();
        const deckId = await run(create, ctx, limitedDeck("event-1"));
        expect(tables.limitedDeckPools).toEqual([
            expect.objectContaining({ deckId, pool: [POOL_BOLT, POOL_BOLT] }),
        ]);
        expect(tables.userDecks[0]).not.toHaveProperty("pool");
    });

    it("a save whose Pool is unchanged performs no Deck Pool write; a grown Pool refreshes it", async () => {
        const { ctx, tables, writes } = world();
        const deckId = await run(create, ctx, limitedDeck("event-1"));
        const before = deckPoolWrites(writes);

        await run(update, ctx, { id: deckId, patch: { name: "Renamed" } });
        expect(deckPoolWrites(writes)).toBe(before);

        const GIANT = {
            scryfallId: "p-giant",
            cardId: "giant",
            cardName: "Giant",
        };
        tables.limitedSeats[0].pool = [POOL_BOLT, POOL_BOLT, GIANT];
        await run(update, ctx, { id: deckId, patch: { name: "Again" } });
        expect(deckPoolWrites(writes)).toBe(before + 1);
        expect(tables.limitedDeckPools[0].pool).toEqual([
            POOL_BOLT,
            POOL_BOLT,
            GIANT,
        ]);
    });

    it("removing the deck removes its Deck Pool", async () => {
        const { ctx, tables } = world();
        const deckId = await run(create, ctx, limitedDeck("event-1"));
        await run(remove, ctx, { id: deckId });
        expect(tables.limitedDeckPools ?? []).toEqual([]);
    });
});

describe("Deck Pool — sole legality authority in listMine (ADR 0106 §3)", () => {
    it("a deck whose event and seat payload are gone is still legal, read without touching either", async () => {
        const { ctx, tables, reads, gets } = world();
        await run(create, ctx, limitedDeck("event-1"));

        tables.limitedEvents = [];
        tables.limitedSeats = [];
        reads.length = 0;
        gets.length = 0;

        const [row] = await run(listMine, ctx, {});
        expect(row.reasons).toEqual([]);
        expect(row.isLegal).toBe(true);
        expect(reads.map((r) => r.table)).not.toContain("limitedSeats");
        expect(gets).not.toContain("event-1");
    });

    it("judges against the Deck Pool, not the Seat: a seat that changed after the save does not move the verdict", async () => {
        const { ctx, tables } = world();
        await run(create, ctx, limitedDeck("event-1"));
        tables.limitedSeats[0].pool = [POOL_BOLT];

        const [row] = await run(listMine, ctx, {});
        expect(row.isLegal).toBe(true);
    });

    it("a limited deck with no Deck Pool is pool-unresolved even while its event resolves", async () => {
        const { ctx, tables } = world();
        await run(create, ctx, limitedDeck("event-1"));
        tables.limitedDeckPools = [];

        const [row] = await run(listMine, ctx, {});
        expect(row.isLegal).toBe(false);
        expect(row.reasons.map((r: any) => r.code)).toContain(
            "pool-unresolved"
        );
    });
});

describe("migrateDeckPools — one-shot backfill (ADR 0106 §8)", () => {
    it("backfills recoverable decks, reports unrecoverable ones, and is idempotent", async () => {
        const legacy = (id: string, eventId: string) => ({
            _id: id,
            userId: ALICE,
            ...limitedDeck(eventId),
        });
        const { ctx, tables } = makeInMemoryDb({
            limitedEvents: [sealedEvent("event-live")],
            limitedSeats: [seatRow("event-live", [POOL_BOLT, POOL_BOLT])],
            userDecks: [
                legacy("deck-live", "event-live"),
                legacy("deck-gone", "event-gone"),
                { _id: "deck-constructed", userId: ALICE, format: "freeform" },
            ],
        });

        const first = await run(migrateDeckPools, ctx, {});
        expect(first).toEqual({
            backfilled: 1,
            present: 0,
            unrecoverable: ["deck-gone"],
        });
        expect(tables.limitedDeckPools).toEqual([
            expect.objectContaining({
                deckId: "deck-live",
                pool: [POOL_BOLT, POOL_BOLT],
            }),
        ]);
        expect(tables.userDecks.map((r) => r._id)).toContain("deck-gone");

        const second = await run(migrateDeckPools, ctx, {});
        expect(second).toEqual({
            backfilled: 0,
            present: 1,
            unrecoverable: ["deck-gone"],
        });
        expect(tables.limitedDeckPools).toHaveLength(1);
    });
});
