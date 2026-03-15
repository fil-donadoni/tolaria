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
        state: v.any(),
        updatedAt: v.number(),
    }),
    games: defineTable({
        name: v.string(),
        players: v.array(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    }),
});
