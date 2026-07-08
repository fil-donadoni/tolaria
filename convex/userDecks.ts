import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { getCurrentUserId } from "./auth";
import { type FormatId, isFormatId } from "./formats";

const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
});

// Typed deck Format (ADR 0036). Chosen at creation and immutable thereafter,
// so create requires it but `update` intentionally does NOT accept it.
const formatValidator = v.union(
    v.literal("freeform"),
    v.literal("alpha-40"),
    v.literal("old-school"),
    v.literal("premodern")
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

export const listMine = query({
    args: {},
    handler: async (ctx) => {
        const userId = await getCurrentUserId(ctx);
        return await ctx.db
            .query("userDecks")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .order("desc")
            .collect();
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
    },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        const name = args.name.trim() || "Untitled deck";
        return await ctx.db.insert("userDecks", {
            userId,
            name,
            format: args.format,
            colors: args.colors,
            cards: args.cards,
            sideboard: args.sideboard,
            description: args.description,
            featuredCardId: args.featuredCardId,
        });
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
