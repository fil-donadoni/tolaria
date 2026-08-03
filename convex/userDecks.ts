import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUserId } from "./auth";
import { type FormatId, isFormatId } from "./formats";
import { openPlayPhaseIfReady } from "./limitedEvents";
import {
    assertLimitedSeatOwnership,
    findSeatPool,
    resolveLimitedDeckLegality,
} from "./limited/poolResolution";
import { hydrateSeat } from "./limitedSeatStore";

const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
});

// Typed deck Format (ADR 0036). Chosen at creation and immutable thereafter,
// so create requires it but `update` intentionally does NOT accept it.
// `"limited"` (ADR 0054/0055, issue #1109) is pool-scoped rather than
// catalogue-scoped — see `limitedEventId`/`limitedSeatId` below.
const formatValidator = v.union(
    v.literal("freeform"),
    v.literal("alpha-40"),
    v.literal("old-school"),
    v.literal("premodern"),
    v.literal("limited"),
    v.literal("manual")
);

type AnyCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

async function assertOwnsDeck(
    ctx: AnyCtx,
    deckId: Id<"userDecks">,
    userId: Id<"users">
) {
    const deck = await ctx.db.get(deckId);
    if (!deck) throw new Error("Deck not found");
    if (deck.userId !== userId) throw new Error("Forbidden");
    return deck;
}

/**
 * Every user deck, with a `limited`-format row's advisory legality
 * pre-resolved server-side (issue #1111). A `limited` deck's Pool lives on
 * its Limited Event Seat, not in the deck row itself — the client has no way
 * to derive `ResolvePool` on its own, so without this a bare client-side
 * `validateDeck` call (`toUserLobbyDeck`) would always read
 * `pool-unresolved` and block selection everywhere except the pool-scoped
 * builder. One event fetch per DISTINCT `limitedEventId` among the caller's
 * own rows (a user very rarely has more than one Limited deck in flight).
 */
export const listMine = query({
    args: {},
    handler: async (ctx) => {
        const userId = await getCurrentUserId(ctx);
        const rows = await ctx.db
            .query("userDecks")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .order("desc")
            .collect();

        const eventCache = new Map<string, Doc<"limitedEvents"> | null>();
        return await Promise.all(
            rows.map(async (row) => {
                if (
                    row.format !== "limited" ||
                    !row.limitedEventId ||
                    !row.limitedSeatId
                ) {
                    return row;
                }
                let event = eventCache.get(row.limitedEventId);
                if (event === undefined) {
                    event =
                        (await ctx.db.get(
                            row.limitedEventId as Id<"limitedEvents">
                        )) ?? null;
                    eventCache.set(row.limitedEventId, event);
                }
                // Only the deck's own seat is loaded — this runs per deck row
                // in a query the lobby keeps subscribed, so pulling the whole
                // event's Pools here would undo the `limitedSeats` split
                // (`convex/limitedSeatStore.ts`).
                const seatIndex = Number(row.limitedSeatId);
                const seatPool = event
                    ? findSeatPool(
                          await hydrateSeat(ctx, event, seatIndex),
                          seatIndex
                      )
                    : null;
                const { isLegal, reasons } = resolveLimitedDeckLegality(
                    row,
                    seatPool
                );
                return { ...row, isLegal, reasons };
            })
        );
    },
});

export const get = query({
    args: { id: v.id("userDecks") },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        return await assertOwnsDeck(ctx, args.id, userId);
    },
});

export const create = mutation({
    args: {
        name: v.string(),
        // Required, typed Format — chosen at creation (ADR 0036).
        format: formatValidator,
        colors: v.array(v.string()),
        cards: v.array(deckCardValidator),
        sideboard: v.optional(v.array(deckCardValidator)),
        description: v.optional(v.string()),
        // Featured Card override (PRD #589, issue #593). Optional Card ID;
        // absent ⇒ the resolver defaults to the first Maindeck card on read.
        featuredCardId: v.optional(v.string()),
        // Limited Event + Seat reference (ADR 0054/0055, issue #1109). Set
        // once at creation for a `format: "limited"` deck, exactly like
        // `format` itself is immutable thereafter — `update` intentionally
        // does not accept these two fields.
        limitedEventId: v.optional(v.string()),
        limitedSeatId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);

        // Limited Event + Seat reference (issue #1111 AC: "a user builds
        // only in their OWN seat — server-derive userId, never trust client
        // seat id"). Both fields travel together or not at all; ownership is
        // re-derived from the AUTHENTICATED userId against the event's real
        // seats, never taken on the client's word.
        if (
            args.limitedEventId !== undefined ||
            args.limitedSeatId !== undefined
        ) {
            if (
                args.limitedEventId === undefined ||
                args.limitedSeatId === undefined
            ) {
                throw new Error(
                    "limitedEventId and limitedSeatId must be provided together."
                );
            }
            const event = await ctx.db.get(
                args.limitedEventId as Id<"limitedEvents">
            );
            assertLimitedSeatOwnership(event, args.limitedSeatId, userId);
        }

        const name = args.name.trim() || "Untitled deck";
        const deckId = await ctx.db.insert("userDecks", {
            userId,
            name,
            format: args.format,
            colors: args.colors,
            cards: args.cards,
            sideboard: args.sideboard,
            description: args.description,
            featuredCardId: args.featuredCardId,
            limitedEventId: args.limitedEventId,
            limitedSeatId: args.limitedSeatId,
        });

        // Limited Event play phase (PRD #1628, ADR 0076, issue #1644): this
        // insert may have been the LAST seat's deck, which is exactly the
        // moment the event stops being a deckbuilding exercise and becomes an
        // event — it flips to `playing` and round 1 is paired, with every
        // bot-vs-bot pairing decided in this same transaction. Self-gating:
        // `openPlayPhaseIfReady` re-derives completion from the database and
        // no-ops when the table is still waiting on someone, so this needs no
        // condition of its own beyond "is this even a Limited Event deck".
        if (args.limitedEventId !== undefined) {
            await openPlayPhaseIfReady(
                ctx,
                args.limitedEventId as Id<"limitedEvents">,
                Date.now()
            );
        }
        return deckId;
    },
});

export const update = mutation({
    args: {
        id: v.id("userDecks"),
        patch: v.object({
            name: v.optional(v.string()),
            // `format` is intentionally absent: it is immutable after creation
            // (ADR 0036). Cross-format reuse goes through export → new deck.
            colors: v.optional(v.array(v.string())),
            cards: v.optional(v.array(deckCardValidator)),
            sideboard: v.optional(v.array(deckCardValidator)),
            description: v.optional(v.string()),
            // Featured Card override (PRD #589, issue #593). Set or change the
            // stored Card ID; an absent value in the patch leaves it untouched.
            featuredCardId: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        await assertOwnsDeck(ctx, args.id, userId);
        const patch: Record<string, unknown> = {};
        if (args.patch.name !== undefined) {
            patch.name = args.patch.name.trim() || "Untitled deck";
        }
        if (args.patch.colors !== undefined) patch.colors = args.patch.colors;
        if (args.patch.cards !== undefined) patch.cards = args.patch.cards;
        if (args.patch.sideboard !== undefined)
            patch.sideboard = args.patch.sideboard;
        if (args.patch.description !== undefined)
            patch.description = args.patch.description;
        if (args.patch.featuredCardId !== undefined)
            patch.featuredCardId = args.patch.featuredCardId;
        if (Object.keys(patch).length === 0) return null;
        await ctx.db.patch(args.id, patch);
        return null;
    },
});

export const remove = mutation({
    args: { id: v.id("userDecks") },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        await assertOwnsDeck(ctx, args.id, userId);
        await ctx.db.delete(args.id);
        return null;
    },
});

/**
 * Map a legacy free-form `format` string to a typed `FormatId` (ADR 0036).
 * Pre-#510 every deck stored the literal `"Freeform"`; the only legacy value in
 * the wild is that string, which becomes `"freeform"`. Any already-typed value
 * passes through unchanged; anything unrecognized falls back to `"freeform"`
 * (the legal-by-default Format) so the migration never drops or breaks a deck.
 * Pure and exported so the normalization is unit-tested without a Convex
 * harness (the project has no convex-test harness).
 */
export function normalizeLegacyFormat(raw: string): FormatId {
    if (isFormatId(raw)) return raw;
    // "Freeform", "freeform " with stray casing/space, or anything else →
    // freeform: every legacy deck is a legal draft, never lost.
    return "freeform";
}

/**
 * One-shot migration: normalize every `userDecks` row's legacy `format` string
 * to a typed `FormatId` (ADR 0036). Idempotent — a row already on a typed value
 * is left untouched, so re-running is safe. No user deck is deleted. Run once
 * via the Convex dashboard / `mcp run` after this slice deploys. Reads the row
 * format as a raw string (it predates the typed union) to decide the target.
 */
export const migrateLegacyFormats = internalMutation({
    args: {},
    returns: v.object({ migrated: v.number(), unchanged: v.number() }),
    handler: async (ctx) => {
        const rows = await ctx.db.query("userDecks").collect();
        let migrated = 0;
        let unchanged = 0;
        for (const row of rows) {
            const current = row.format as string;
            const normalized = normalizeLegacyFormat(current);
            if (current === normalized) {
                unchanged++;
                continue;
            }
            await ctx.db.patch(row._id, { format: normalized });
            migrated++;
        }
        return { migrated, unchanged };
    },
});
