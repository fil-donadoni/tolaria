import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getCurrentUserId } from "./auth";

const deckCardValidator = v.object({
    cardId: v.string(),
    cardName: v.string(),
});

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
        format: v.string(),
        colors: v.array(v.string()),
        cards: v.array(deckCardValidator),
        description: v.optional(v.string()),
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
            description: args.description,
        });
    },
});

export const update = mutation({
    args: {
        id: v.id("userDecks"),
        patch: v.object({
            name: v.optional(v.string()),
            format: v.optional(v.string()),
            colors: v.optional(v.array(v.string())),
            cards: v.optional(v.array(deckCardValidator)),
            description: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        await assertOwnsDeck(ctx, args.id, userId);
        const patch: Record<string, unknown> = {};
        if (args.patch.name !== undefined) {
            patch.name = args.patch.name.trim() || "Untitled deck";
        }
        if (args.patch.format !== undefined) patch.format = args.patch.format;
        if (args.patch.colors !== undefined) patch.colors = args.patch.colors;
        if (args.patch.cards !== undefined) patch.cards = args.patch.cards;
        if (args.patch.description !== undefined)
            patch.description = args.patch.description;
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
