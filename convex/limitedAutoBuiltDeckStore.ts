// The `limitedAutoBuiltDecks` seam (issue #8896): the ONE module that reads or
// writes an auto-driven Seat's STORED Auto-Built deck — a Bot Drafter seat, or
// a Dropped Seat with no submitted deck.
//
// Owner rule (2026-11-08): a review never changes a choice already made. The
// deck is DECIDED once, when the seat's Pool is final (Sealed: Pools dealt;
// Draft: draft completed) or, for a seat that drops after that, when it drops
// — and stored. Every later reader (round pairing strength, the pairing Match
// hookup in `convex/game.ts`, the event view, the archive) reads this row, so
// an Admin edit to a Card Profile or a Pick Rating after Pool-final never
// reaches a deck already built.
//
// Legacy tolerance: an event whose Pools were final BEFORE this table existed
// has no rows; its readers fall back to on-demand computation
// (`convex/limitedEvents.ts`'s `autoBuildSeatDeck`). No backfill — a backfill
// would itself build with TODAY's profiles, which is no more "the deck decided
// back then" than the fallback is.
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { AutoBuiltDeck, TrueColor } from "./limited/autoBuild";

/** Every stored Auto-Built deck of an event, keyed by seat index. */
export async function loadStoredAutoBuiltDecks(
    ctx: QueryCtx,
    eventId: Id<"limitedEvents">
): Promise<Map<number, AutoBuiltDeck>> {
    const rows = await ctx.db
        .query("limitedAutoBuiltDecks")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    return new Map(rows.map((row) => [row.seatIndex, toDeck(row)]));
}

/** ONE seat's stored Auto-Built deck, or `null` when none was stored. */
export async function loadStoredAutoBuiltDeck(
    ctx: QueryCtx,
    eventId: Id<"limitedEvents">,
    seatIndex: number
): Promise<AutoBuiltDeck | null> {
    const row = await ctx.db
        .query("limitedAutoBuiltDecks")
        .withIndex("by_event", (q) =>
            q.eq("eventId", eventId).eq("seatIndex", seatIndex)
        )
        .unique();
    return row ? toDeck(row) : null;
}

/** Stores a seat's deck — once. An existing row is never overwritten: the
 *  first decision stands, which is the whole point of this table. */
export async function saveAutoBuiltDeck(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">,
    seatIndex: number,
    deck: AutoBuiltDeck
): Promise<void> {
    const existing = await loadStoredAutoBuiltDeck(ctx, eventId, seatIndex);
    if (existing) return;
    await ctx.db.insert("limitedAutoBuiltDecks", {
        eventId,
        seatIndex,
        cards: deck.cards.map(({ cardId, cardName }) => ({ cardId, cardName })),
        sideboard: deck.sideboard.map(({ cardId, cardName }) => ({
            cardId,
            cardName,
        })),
        colors: [...deck.colors],
    });
}

/** Deletes every stored deck of an event — for the event's own deletion
 *  (cancel / GC), which would otherwise orphan them. */
export async function deleteAutoBuiltDecks(
    ctx: MutationCtx,
    eventId: Id<"limitedEvents">
): Promise<void> {
    const rows = await ctx.db
        .query("limitedAutoBuiltDecks")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .collect();
    for (const row of rows) await ctx.db.delete(row._id);
}

function toDeck(row: {
    cards: { cardId: string; cardName: string }[];
    sideboard: { cardId: string; cardName: string }[];
    colors: TrueColor[];
}): AutoBuiltDeck {
    return {
        cards: row.cards.map(({ cardId, cardName }) => ({ cardId, cardName })),
        sideboard: row.sideboard.map(({ cardId, cardName }) => ({
            cardId,
            cardName,
        })),
        colors: [...row.colors],
    };
}
