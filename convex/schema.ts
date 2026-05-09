import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    events: defineTable({
        gameId: v.id("games"),
        seq: v.number(),
        type: v.string(),
        player: v.string(),
        payload: v.any(),
        timestamp: v.number(),
    }),
    game_states: defineTable({
        gameId: v.id("games"),
        seq: v.number(),
        state: v.any(),
        updatedAt: v.number(),
    }).index("by_gameId", ["gameId", "seq"]),
    decks: defineTable({
        presetId: v.string(),
        name: v.string(),
        format: v.string(),
        description: v.optional(v.string()),
        colors: v.array(v.string()),
        cards: v.array(
            v.object({
                cardId: v.string(),
                cardName: v.string(),
            })
        ),
    }).index("by_presetId", ["presetId"]),
    /**
     * Search/filter index for the deck-builder UI. One row per
     * `CardDefinition` (reprints not duplicated). Populated by
     * `cardIndex.syncCardIndex`, which walks every card declared in
     * `convex/cards/sets/*.ts`. The frontend queries `cardIndex.list` to drive
     * the builder's results grid; oracle text is aggregated from every
     * text-bearing field on the definition (keywords + ability oracle text +
     * intrinsic basic-land mana lines).
     */
    card_index: defineTable({
        cardId: v.string(),
        name: v.string(),
        nameLower: v.string(),
        types: v.array(v.string()),
        subtypes: v.array(v.string()),
        colors: v.array(v.string()),
        manaValue: v.number(),
        oracleText: v.string(),
    }).index("by_cardId", ["cardId"]),
    games: defineTable({
        name: v.string(),
        status: v.union(
            v.literal("waiting"),
            v.literal("playing"),
            v.literal("finished")
        ),
        players: v.array(
            v.object({
                id: v.string(),
                name: v.string(),
                bgColor: v.string(),
                deck: v.object({
                    id: v.string(),
                    name: v.string(),
                    format: v.string(),
                    cards: v.array(
                        v.object({
                            cardId: v.string(),
                            cardName: v.string(),
                        })
                    ),
                }),
            })
        ),
        /** ID of the winning player (set when status transitions to "finished"). */
        winner: v.optional(v.string()),
        /** Solo (single-user) game: both players belong to the same user. The client
         * auto-switches its viewer to the player who currently has priority. */
        solo: v.optional(v.boolean()),
        createdAt: v.number(),
        updatedAt: v.number(),
    }),
});
