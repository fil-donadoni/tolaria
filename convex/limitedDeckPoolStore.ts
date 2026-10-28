// Deck Pool storage (ADR 0106): the `limitedDeckPools` companion table, keyed
// by deck id, is read and written ONLY here. The Pool lives apart from the
// `userDecks` row because the lobby keeps `userDecks.listMine` subscribed and
// Convex bills a read by the whole document. The decisions (write vs skip,
// backfill classification) are the pure `convex/limited/deckPool.ts`.

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
    canonicalDeckPool,
    deckPoolNeedsWrite,
    type DeckPoolCards,
} from "./limited/deckPool";
import type { LimitedPoolCard } from "./limited/eventTypes";
import { findSeatPool } from "./limited/poolResolution";
import { hydrateSeat } from "./limitedSeatStore";

async function findRow(ctx: Pick<QueryCtx, "db">, deckId: Id<"userDecks">) {
    return await ctx.db
        .query("limitedDeckPools")
        .withIndex("by_deck", (q) => q.eq("deckId", deckId))
        .unique();
}

/** The deck's Deck Pool, or `null` when it has none — which `limitedValidate`
 *  reports as `pool-unresolved`, never a silent pass. */
export async function loadDeckPool(
    ctx: Pick<QueryCtx, "db">,
    deckId: Id<"userDecks">
): Promise<LimitedPoolCard[] | null> {
    return (await findRow(ctx, deckId))?.pool ?? null;
}

/** Writes `pool` as the deck's Deck Pool, skipping the write when it is
 *  identical to the stored one. Returns whether it wrote. */
export async function saveDeckPool(
    ctx: MutationCtx,
    deckId: Id<"userDecks">,
    pool: DeckPoolCards
): Promise<boolean> {
    const row = await findRow(ctx, deckId);
    if (!deckPoolNeedsWrite(row?.pool ?? null, pool)) return false;
    const payload = canonicalDeckPool(pool);
    if (row) await ctx.db.patch(row._id, { pool: payload });
    else await ctx.db.insert("limitedDeckPools", { deckId, pool: payload });
    return true;
}

/** Deletes the deck's Deck Pool, beside the deck row it belongs to. Returns
 *  whether there was one. */
export async function deleteDeckPool(
    ctx: MutationCtx,
    deckId: Id<"userDecks">
): Promise<boolean> {
    const row = await findRow(ctx, deckId);
    if (!row) return false;
    await ctx.db.delete(row._id);
    return true;
}

/** The Pool of the Seat a deck was built at — the WORKING Pool the save path
 *  copies into the Deck Pool while the event exists. `null` when the event,
 *  the seat or its Pool no longer resolve (a dangling provenance id is
 *  harmless: the Deck Pool already stored stays the deck's authority). Never
 *  a legality source. */
export async function loadSeatPoolForDeck(
    ctx: QueryCtx,
    deck: { limitedEventId?: string; limitedSeatId?: string }
): Promise<LimitedPoolCard[] | null> {
    if (!deck.limitedEventId || !deck.limitedSeatId) return null;
    const eventId = ctx.db.normalizeId("limitedEvents", deck.limitedEventId);
    const event = eventId ? await ctx.db.get(eventId) : null;
    const seatIndex = Number(deck.limitedSeatId);
    if (!event || !Number.isInteger(seatIndex)) return null;
    const pool = findSeatPool(
        await hydrateSeat(ctx, event, seatIndex),
        seatIndex
    );
    return pool ? [...pool] : null;
}
