import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    ...authTables,
    users: defineTable({
        name: v.optional(v.string()),
        image: v.optional(v.string()),
        email: v.optional(v.string()),
        emailVerificationTime: v.optional(v.number()),
        phone: v.optional(v.string()),
        phoneVerificationTime: v.optional(v.number()),
        isAnonymous: v.optional(v.boolean()),
        nickname: v.string(),
    }).index("email", ["email"]),
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
    userDecks: defineTable({
        userId: v.id("users"),
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
    }).index("by_user", ["userId"]),
    games: defineTable({
        name: v.string(),
        status: v.union(
            v.literal("waiting"),
            v.literal("playing"),
            v.literal("finished")
        ),
        // `players[].id` is an opaque player handle used by the GRE as
        // controllerId/ownerId. For 2-player games it equals the user's
        // `Id<"users">`; for solo games it is `${userId}-p1` / `${userId}-p2`.
        // Keep as v.string() to accommodate both shapes.
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
    }).index("by_status", ["status"]),
});
