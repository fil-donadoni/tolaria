import { mutation, query } from "./_generated/server";
import { PRESET_DECKS } from "./deckPresets";

export const list = query({
    args: {},
    handler: async (ctx) => {
        const decks = await ctx.db.query("decks").collect();
        return decks.sort((a, b) => a.presetId.localeCompare(b.presetId));
    },
});

export const seedIfEmpty = mutation({
    args: {},
    handler: async (ctx) => {
        for (const preset of PRESET_DECKS) {
            const existing = await ctx.db
                .query("decks")
                .withIndex("by_presetId", (q) =>
                    q.eq("presetId", preset.presetId)
                )
                .unique();
            if (!existing) {
                await ctx.db.insert("decks", preset);
            }
        }
    },
});
