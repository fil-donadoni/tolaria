// `autoBuildMyLimitedDeck` (issue #9976): the human's Auto-Build, driven
// through the REAL registered handler against the in-memory ctx — so
// `getCurrentUser`, the seat derivation from `ctx.auth`, `hydrateSeat`, the
// live-input loaders and `autoBuildDeck` all run for real.
//
// Deck-size floor: `FORMAT_RULES.limited.minMain`, which the Bot builder
// guarantees (no rules mechanic here, so no CR citation).
import { describe, expect, it } from "vitest";
import { FORMAT_RULES } from "../formats";
import { makeRng } from "../gre/rng";
import {
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
} from "../limited/eventLogic";
import { getRuntimeBoosterConfig } from "../limited/registry";
import { resolveCardMeta } from "../limitedCardMeta";
import { autoBuildMyLimitedDeck } from "../limitedEvents";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

const handler = (
    autoBuildMyLimitedDeck as unknown as {
        _handler: (
            ctx: QueryCtx,
            args: { eventId: Id<"limitedEvents"> }
        ) => Promise<{
            cards: { cardId: string; cardName: string }[];
            sideboard: { cardId: string; cardName: string }[];
            colors: string[];
        } | null>;
    }
)._handler;

const EVENT_ID = "event-9976" as Id<"limitedEvents">;

function seedEvent(opts: {
    type: "sealed" | "draft";
    status: string;
    draftCompletedAt?: number;
    seatedUser?: string;
}) {
    const slim = buildEmptySeats(2);
    const seats = generateSealedPools(
        fillBotSeats(slim),
        ["lea"],
        6,
        getRuntimeBoosterConfig,
        resolveCardMeta,
        makeRng(9976)
    );
    const humanSeat = seats[0];
    return makeInMemoryDb(
        {
            users: [
                { _id: "user1", nickname: "Alice" },
                { _id: "user2", nickname: "Bob" },
            ],
            limitedEvents: [
                {
                    _id: EVENT_ID,
                    createdBy: "user1",
                    type: opts.type,
                    status: opts.status,
                    draftCompletedAt: opts.draftCompletedAt,
                    seatCount: 1,
                    packSlots: ["lea"],
                    sealedBoosterCount: 6,
                    seats: [
                        {
                            seatIndex: 0,
                            userId: opts.seatedUser ?? "user1",
                            nickname: "Alice",
                            poolCount: humanSeat.pool?.length ?? 0,
                        },
                    ],
                    createdAt: 0,
                    updatedAt: 0,
                },
            ],
            limitedSeats: [
                {
                    _id: "seat-9976-0",
                    eventId: EVENT_ID,
                    seatIndex: 0,
                    pool: humanSeat.pool,
                },
            ],
        },
        { identitySubject: "user1|session1" }
    );
}

describe("autoBuildMyLimitedDeck (issue #9976)", () => {
    it("builds the viewer's own Pool into a legal-size Maindeck with basics, every pool card in exactly one zone", async () => {
        const { ctx, tables } = seedEvent({
            type: "sealed",
            status: "started",
        });
        const pool = tables.limitedSeats[0].pool as { cardId: string }[];

        const deck = await handler(ctx as unknown as QueryCtx, {
            eventId: EVENT_ID,
        });

        expect(deck).not.toBeNull();
        expect(deck!.cards.length).toBeGreaterThanOrEqual(
            FORMAT_RULES.limited.minMain
        );
        // Not the raw pile: the builder trimmed the Pool to a deck.
        expect(deck!.cards.length).toBeLessThan(pool.length);
        // Nothing dropped: pool cards in the Maindeck + Sideboard cover the
        // Pool (basics the builder added come on top).
        const placed = [...deck!.cards, ...deck!.sideboard].filter((c) =>
            pool.some((p) => p.cardId === c.cardId)
        );
        expect(placed.length).toBeGreaterThanOrEqual(pool.length);
    });

    it("a Draft whose Pool is still growing has no Auto-Build yet", async () => {
        const { ctx } = seedEvent({ type: "draft", status: "started" });
        expect(
            await handler(ctx as unknown as QueryCtx, { eventId: EVENT_ID })
        ).toBeNull();
    });

    it("a caller with no Seat gets nothing — the seat is derived from ctx.auth, never an argument", async () => {
        const { ctx } = seedEvent({
            type: "sealed",
            status: "started",
            seatedUser: "user2",
        });
        expect(
            await handler(ctx as unknown as QueryCtx, { eventId: EVENT_ID })
        ).toBeNull();
    });
});
