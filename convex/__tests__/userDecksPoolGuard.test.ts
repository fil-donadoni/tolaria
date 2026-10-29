// `userDecks.update` on a `limited` deck refuses a patch that introduces a card
// its Deck Pool does not account for (issue #2816), driven for real against
// the shared in-memory ctx (no convex-test harness, see
// `deckDefinitionIdWrite.test.ts`).
import { describe, expect, it } from "vitest";

import type { MutationCtx } from "../_generated/server";
import { resolveDeckCardMeta } from "../cards";
import { create, update } from "../userDecks";
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
const BOLT = { cardId: BOLT_PRINT, cardName: "Lightning Bolt" };
const OFF_POOL = { cardId: "off-pool-card", cardName: "Not In Pool" };
const BASIC = { cardId: MOUNTAIN, cardName: "Mountain" };
const POOL_BOLT = {
    scryfallId: BOLT_PRINT,
    cardId: resolveDeckCardMeta(BOLT_PRINT)!.cardId,
    cardName: "Lightning Bolt",
};

const event: InMemoryRow = {
    _id: "event-1",
    type: "sealed",
    status: "started",
    packSlots: ["lea"],
    seats: [{ seatIndex: 0, userId: ALICE, displayName: "Alice" }],
};

const basics = (n: number) => Array.from({ length: n }, () => BASIC);

function world() {
    return makeInMemoryDb(
        {
            users: [{ _id: ALICE, nickname: "Alice" }],
            limitedEvents: [event],
            limitedSeats: [
                {
                    _id: "seat-1",
                    eventId: "event-1",
                    seatIndex: 0,
                    pool: [POOL_BOLT, POOL_BOLT],
                },
            ],
        },
        { identitySubject: `${ALICE}|session` }
    );
}

const limitedDeck = {
    name: "Sealed",
    format: "limited",
    colors: ["R"],
    cards: [BOLT, ...basics(39)],
    sideboard: [BOLT],
    limitedEventId: "event-1",
    limitedSeatId: "0",
};

describe("userDecks.update — Deck Pool introduction guard (issue #2816)", () => {
    it("refuses a patch introducing an off-Pool card, with a client-safe message", async () => {
        const { ctx, tables } = world();
        const id = await run(create, ctx, limitedDeck);
        await expect(
            run(update, ctx, {
                id,
                patch: { cards: [BOLT, OFF_POOL, ...basics(39)] },
            })
        ).rejects.toThrow(/Not In Pool: not in this seat's Pool/);
        expect(tables.userDecks[0].cards).toHaveLength(40);
    });

    it("accepts a zone move, a removal and a free basic", async () => {
        const { ctx, tables } = world();
        const id = await run(create, ctx, limitedDeck);
        await run(update, ctx, {
            id,
            patch: { cards: [BOLT, BOLT, ...basics(38)], sideboard: [] },
        });
        await run(update, ctx, { id, patch: { sideboard: [] } });
        await run(update, ctx, {
            id,
            patch: { cards: [BOLT, ...basics(45)] },
        });
        expect(tables.userDecks[0].cards).toHaveLength(46);
    });

    it("lets a deck already illegal be patched back by removing the offender", async () => {
        const { ctx, tables } = world();
        const id = await run(create, ctx, limitedDeck);
        tables.userDecks[0].cards = [BOLT, OFF_POOL, ...basics(38)];
        await run(update, ctx, {
            id,
            patch: { cards: [BOLT, ...basics(39)] },
        });
        expect(tables.userDecks[0].cards).toHaveLength(40);
    });

    it("leaves non-limited decks unguarded", async () => {
        const { ctx, tables } = world();
        const id = await run(create, ctx, {
            name: "Free",
            format: "freeform",
            colors: ["R"],
            cards: [BOLT],
        });
        await run(update, ctx, { id, patch: { cards: [BOLT, OFF_POOL] } });
        expect(tables.userDecks[0].cards).toHaveLength(2);
    });
});
