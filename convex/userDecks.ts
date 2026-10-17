import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUserId } from "./auth";
import { fillDefinitionIds, loadPrintRows } from "./cardPrintRows";
import { withDefinitionId } from "./cards/catalogue";
import { makeResolveCardFromRows } from "./cards/printRows";
import { storedDeckColumnLayoutValidator } from "./deckLayoutStorage";
import { loadBanlistOverridesByFormat } from "./decks";
import { type FormatId, isFormatId, validateDeck } from "./formats";
import { openPlayPhaseIfReady } from "./limitedEvents";
import {
    assertLimitedSeatOwnership,
    findSeatPool,
    resolveLimitedDeckLegality,
} from "./limited/poolResolution";
import { limitedOriginKey } from "./limited/limitedOrigin";
import { hydrateSeat } from "./limitedSeatStore";

const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
    definitionId: v.optional(v.string()),
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

        // Legality for every non-limited deck is derived HERE, not in the
        // browser (issue #4854): the lobby renders without the card catalogue,
        // and `validateDeck` needs the definitions to resolve a card's set and
        // rarity. Same derivation `decks.list` runs for presets — recomputed
        // on every read (ADR 0036), reactive to a DB banlist sync.
        const banlists = await loadBanlistOverridesByFormat(ctx);
        const eventCache = new Map<string, Doc<"limitedEvents"> | null>();
        return await Promise.all(
            rows.map(async (row) => {
                if (
                    row.format !== "limited" ||
                    !row.limitedEventId ||
                    !row.limitedSeatId
                ) {
                    // The CHOSEN printing's Set and Rarity are the table's
                    // (issue #5106): Old School judges Set, Alpha 40 Rarity.
                    const resolve = makeResolveCardFromRows(
                        await loadPrintRows(
                            ctx,
                            [...row.cards, ...(row.sideboard ?? [])].map(
                                (c) => c.cardId
                            )
                        )
                    );
                    const { isLegal, reasons } = validateDeck(
                        row,
                        row.format,
                        resolve,
                        banlists[row.format]
                    );
                    return { ...row, isLegal, reasons };
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
                // A `limited` entry's `cardId` is the opened PRINT (ADR 0140
                // §5, issue #5473): the deck side of Pool membership resolves
                // through the table rows, exactly as game start does
                // (`createGame`'s `makeResolveCardFromRows`).
                const resolve = makeResolveCardFromRows(
                    await loadPrintRows(
                        ctx,
                        [...row.cards, ...(row.sideboard ?? [])].map(
                            (c) => c.cardId
                        )
                    )
                );
                const { isLegal, reasons } = resolveLimitedDeckLegality(
                    row,
                    seatPool,
                    resolve
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
        // Column Layout (ADR 0075 §4, issue #1626) — manual Columns, deleted
        // Columns and Card Pins. Optional at every level: a deck created
        // before the player arranged anything simply carries none, and a
        // client that never sends the field is unchanged.
        layout: v.optional(storedDeckColumnLayoutValidator),
    },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        let limitedOrigin: string | undefined;

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
            // Limited Origin (ADR 0106 §6, issue #5393): copied from the event
            // HERE, server-side, never taken from the client — and never
            // re-read through the event, so deleting it later leaves the
            // deck classified. Only a `limited` deck is classified by it.
            if (args.format === "limited") {
                limitedOrigin = limitedOriginKey(event);
            }
        }

        const name = args.name.trim() || "Untitled deck";
        const deckId = await ctx.db.insert("userDecks", {
            userId,
            name,
            format: args.format,
            colors: args.colors,
            cards: await fillDefinitionIds(ctx, args.cards),
            sideboard: args.sideboard
                ? await fillDefinitionIds(ctx, args.sideboard)
                : undefined,
            description: args.description,
            featuredCardId: args.featuredCardId,
            limitedEventId: args.limitedEventId,
            limitedSeatId: args.limitedSeatId,
            limitedOrigin,
            layout: args.layout,
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
            // Column Layout (ADR 0075 §4, issue #1626). Absent leaves the
            // stored layout untouched — which is what a client that never
            // arranged anything sends, so editing a pre-#1626 deck's cards
            // never writes a layout onto it. An empty OBJECT is the explicit
            // "the player cleared their arrangement" signal and overwrites.
            // Never merged field-by-field: the client holds the whole layout
            // and a partial merge could resurrect a Column it just deleted.
            layout: v.optional(storedDeckColumnLayoutValidator),
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
        if (args.patch.cards !== undefined)
            patch.cards = await fillDefinitionIds(ctx, args.patch.cards);
        if (args.patch.sideboard !== undefined)
            patch.sideboard = await fillDefinitionIds(
                ctx,
                args.patch.sideboard
            );
        if (args.patch.description !== undefined)
            patch.description = args.patch.description;
        if (args.patch.featuredCardId !== undefined)
            patch.featuredCardId = args.patch.featuredCardId;
        if (args.patch.layout !== undefined) patch.layout = args.patch.layout;
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

/**
 * One-shot migration (issue #4117, ADR 0140): backfill `definitionId` on
 * every `userDecks` row's Maindeck and Sideboard entries via
 * `withDefinitionId`, ahead of narrowing the schema field to required.
 * Idempotent — a row where every entry already carries `definitionId` is
 * left untouched. Run once via the Convex dashboard / `mcp run` after this
 * slice deploys, same as `migrateLegacyFormats` above.
 */
export const migrateDefinitionIds = internalMutation({
    args: {},
    returns: v.object({ migrated: v.number(), unchanged: v.number() }),
    handler: async (ctx) => {
        const rows = await ctx.db.query("userDecks").collect();
        let migrated = 0;
        let unchanged = 0;
        for (const row of rows) {
            const cards = row.cards.map(withDefinitionId);
            const sideboard = row.sideboard?.map(withDefinitionId);
            const cardsChanged = cards.some(
                (c, i) => c.definitionId !== row.cards[i].definitionId
            );
            const sideboardChanged = sideboard?.some(
                (c, i) => c.definitionId !== row.sideboard![i].definitionId
            );
            if (!cardsChanged && !sideboardChanged) {
                unchanged++;
                continue;
            }
            await ctx.db.patch(row._id, { cards, sideboard });
            migrated++;
        }
        return { migrated, unchanged };
    },
});

/**
 * One-shot migration (ADR 0106 §6, issue #5393): give every `limited` deck
 * saved before Limited Origin existed its origin, derived ONCE from its event
 * while that event still exists. A deck whose event is gone stays
 * unclassified — no error, no deletion. Idempotent — a row already carrying
 * an origin is left untouched. Run once via the Convex dashboard / `mcp run`
 * after this slice deploys, same as `migrateLegacyFormats` above.
 */
export const migrateLimitedOrigins = internalMutation({
    args: {},
    returns: v.object({
        migrated: v.number(),
        unclassified: v.number(),
        unchanged: v.number(),
    }),
    handler: async (ctx) => {
        const rows = await ctx.db.query("userDecks").collect();
        let migrated = 0;
        let unclassified = 0;
        let unchanged = 0;
        for (const row of rows) {
            if (row.format !== "limited" || row.limitedOrigin !== undefined) {
                unchanged++;
                continue;
            }
            // A dangling or malformed id is an unclassified deck, never an
            // aborted migration.
            const eventId = row.limitedEventId
                ? ctx.db.normalizeId("limitedEvents", row.limitedEventId)
                : null;
            const event = eventId ? await ctx.db.get(eventId) : null;
            if (!event) {
                unclassified++;
                continue;
            }
            await ctx.db.patch(row._id, {
                limitedOrigin: limitedOriginKey(event),
            });
            migrated++;
        }
        return { migrated, unclassified, unchanged };
    },
});
