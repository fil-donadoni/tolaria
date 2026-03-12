import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    events: defineTable({
        id: v.id("events"),
        gameId: v.id("games"),
        seq: v.number(),
        type: v.string(),
        player: v.string(),
        payload: v.any(),
        timestamp: v.number(),
    }),
    game_states: defineTable({
        id: v.id("game_states"),
        gameId: v.id("games"),
        state: v.any(),
        updatedAt: v.number(),
    }),
    games: defineTable({
        id: v.id("games"),
        name: v.string(),
        players: v.array(v.string()),
        createdAt: v.number(),
        updatedAt: v.number(),
    }),
});
