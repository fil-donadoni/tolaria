import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth, getCurrentUserId } from "./auth";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;

export const currentUser = query({
    args: {},
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        return await ctx.db.get(userId);
    },
});

export const updateNickname = mutation({
    args: { nickname: v.string() },
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        const trimmed = args.nickname.trim();
        if (trimmed.length < NICKNAME_MIN || trimmed.length > NICKNAME_MAX) {
            throw new Error(
                `nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`
            );
        }
        await ctx.db.patch(userId, { nickname: trimmed });
        return null;
    },
});
