// Card index Convex functions. The deck-builder UI queries `list` to render
// the searchable result grid. `syncCardIndex` walks every CardDefinition
// declared in convex/cards/sets/*.ts and upserts a slim row per card; run it
// during dev whenever a new card is added (Debug panel button or
// `bunx convex run cardIndex:syncCardIndex`).

import { mutation, query } from "./_generated/server";
import { getAllCards } from "./cards";
import { getCardColors } from "./cards/colors";
import { aggregateOracleText } from "./cards/oracleAggregator";
import { manaValue } from "./gre/constants";

export const list = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("card_index").collect();
    },
});

export const syncCardIndex = mutation({
    args: {},
    handler: async (ctx) => {
        const cards = getAllCards();
        let inserted = 0;
        let updated = 0;
        const seenIds = new Set<string>();

        for (const def of cards) {
            const oracle = aggregateOracleText(def);
            const row = {
                cardId: def.id,
                name: def.name,
                nameLower: def.name.toLowerCase(),
                types: [...def.types] as string[],
                subtypes: [...(def.subtypes ?? [])],
                colors: getCardColors(def) as string[],
                manaValue: manaValue(def.manaCost),
                oracleText: oracle.searchable,
            };

            const existing = await ctx.db
                .query("card_index")
                .withIndex("by_cardId", (q) => q.eq("cardId", def.id))
                .unique();

            if (existing) {
                await ctx.db.patch(existing._id, row);
                updated += 1;
            } else {
                await ctx.db.insert("card_index", row);
                inserted += 1;
            }
            seenIds.add(def.id);
        }

        // Drop stale rows (cards removed from sets/*.ts since last sync).
        const stale = await ctx.db.query("card_index").collect();
        let removed = 0;
        for (const row of stale) {
            if (!seenIds.has(row.cardId)) {
                await ctx.db.delete(row._id);
                removed += 1;
            }
        }

        return { inserted, updated, removed, total: cards.length };
    },
});
