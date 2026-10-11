// Limited Origin on saved decks (ADR 0106 §6, issue #5393): `userDecks.create`
// copies the origin from the event server-side, it survives the event's
// deletion, and `migrateLimitedOrigins` classifies legacy decks once from a
// surviving event. Handlers driven for real against the shared in-memory ctx
// (no convex-test harness, see `deckDefinitionIdWrite.test.ts`).
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import { create, get, migrateLimitedOrigins } from "../userDecks";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

/* eslint-disable @typescript-eslint/no-explicit-any */
const run = (fn: unknown, ctx: MutationCtx, args: unknown): Promise<any> =>
    (fn as { _handler: (c: MutationCtx, a: unknown) => Promise<any> })._handler(
        ctx,
        args
    );

const ALICE = "user-alice";

// One seat, `started`: `openPlayPhaseIfReady` (run by every Limited deck
// create) no-ops on a table below `MIN_SEATS`, so the test pins the deck
// write alone.
function cubeDraftEvent(_id: string) {
    return {
        _id,
        type: "draft",
        status: "started",
        packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
        seats: [{ seatIndex: 0, userId: ALICE, displayName: "Alice" }],
    };
}

function limitedDeck(eventId: string) {
    return {
        name: "Vintage Cube Draft",
        format: "limited",
        colors: [],
        cards: [],
        limitedEventId: eventId,
        limitedSeatId: "0",
    };
}

describe("Limited Origin on a deck saved from an event (issue #5393)", () => {
    it("is copied from the event and survives the event's deletion", async () => {
        const { ctx, tables } = makeInMemoryDb(
            {
                users: [{ _id: ALICE, nickname: "Alice" }],
                limitedEvents: [cubeDraftEvent("event-1")],
            },
            { identitySubject: `${ALICE}|session` }
        );
        const deckId = await run(create, ctx, limitedDeck("event-1"));
        expect(tables.userDecks[0].limitedOrigin).toBe("draft:cube:vintage");

        await ctx.db.delete("event-1" as never);
        const deck = await run(get, ctx, { id: deckId });
        expect(deck.limitedOrigin).toBe("draft:cube:vintage");
    });

    it("is derived from the event, never taken from the caller", async () => {
        const { ctx, tables } = makeInMemoryDb(
            {
                users: [{ _id: ALICE, nickname: "Alice" }],
                limitedEvents: [cubeDraftEvent("event-1")],
            },
            { identitySubject: `${ALICE}|session` }
        );
        await run(create, ctx, {
            ...limitedDeck("event-1"),
            limitedOrigin: "sealed:lea",
        });
        expect(tables.userDecks[0].limitedOrigin).toBe("draft:cube:vintage");
    });

    it("is absent on a deck not saved from an event", async () => {
        const { ctx, tables } = makeInMemoryDb(
            { users: [{ _id: ALICE, nickname: "Alice" }] },
            { identitySubject: `${ALICE}|session` }
        );
        await run(create, ctx, {
            name: "Burn",
            format: "freeform",
            colors: [],
            cards: [],
        });
        expect(tables.userDecks[0].limitedOrigin).toBeUndefined();
    });
});

describe("migrateLimitedOrigins — legacy decks (issue #5393)", () => {
    it("derives the origin once from a surviving event, else leaves the deck unclassified", async () => {
        const { ctx, tables } = makeInMemoryDb({
            limitedEvents: [
                {
                    ...cubeDraftEvent("event-live"),
                    type: "sealed",
                    packSlots: ["lea"],
                },
            ],
            userDecks: [
                {
                    _id: "legacy-live",
                    format: "limited",
                    limitedEventId: "event-live",
                },
                {
                    _id: "legacy-gone",
                    format: "limited",
                    limitedEventId: "event-gone",
                },
                {
                    _id: "classified",
                    format: "limited",
                    limitedEventId: "event-live",
                    limitedOrigin: "draft:cube:vintage",
                },
                { _id: "constructed", format: "freeform" },
            ],
        });
        const result = await run(migrateLimitedOrigins, ctx, {});
        expect(result).toEqual({ migrated: 1, unclassified: 1, unchanged: 2 });

        const byId = new Map(tables.userDecks.map((row) => [row._id, row]));
        expect(byId.get("legacy-live")!.limitedOrigin).toBe("sealed:lea");
        expect(byId.get("legacy-gone")!.limitedOrigin).toBeUndefined();
        expect(byId.get("classified")!.limitedOrigin).toBe(
            "draft:cube:vintage"
        );
        expect(byId.get("constructed")!.limitedOrigin).toBeUndefined();
    });
});
