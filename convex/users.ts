import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertIsAdmin, auth, getCurrentUserId, isTesterUser } from "./auth";

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

/** One account as the admin roles page renders it (issue #3402). */
const roleRowValidator = v.object({
    _id: v.id("users"),
    nickname: v.string(),
    email: v.optional(v.string()),
    isAdmin: v.boolean(),
    /** The EFFECTIVE answer to "may this account submit a Verdict?", i.e.
     *  `isTesterUser` — true for every admin whether or not the flag is set. */
    isTester: v.boolean(),
    /** The FLAG itself, which is the thing the toggle writes. Separate from
     *  `isTester` on purpose: an admin reads as a tester while its flag is
     *  false, and a toggle bound to the effective value would render as on,
     *  write `false`, and render as on again — a control that appears broken
     *  because it is reporting a different question than the one it answers. */
    testerFlag: v.boolean(),
});

/**
 * Every account with its roles (issue #3402, PRD #3397) — the `/admin/testers`
 * page. Admin-gated; a full scan, which is what a deployment with a few dozen
 * accounts wants and what the page shows anyway.
 */
export const listUserRoles = query({
    args: {},
    returns: v.array(roleRowValidator),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        const rows = await ctx.db.query("users").collect();
        return rows
            .map((user) => ({
                _id: user._id,
                nickname: user.nickname,
                ...(user.email === undefined ? {} : { email: user.email }),
                isAdmin: user.isAdmin === true,
                isTester: isTesterUser(user),
                testerFlag: user.isTester === true,
            }))
            .sort((a, b) => a.nickname.localeCompare(b.nickname));
    },
});

/**
 * Grant or revoke the tester role (issue #3402). Admin-gated — the role is
 * "whose judgement about a Bot decision is worth fitting the evaluation to",
 * so it is granted by the people who curate, exactly like every other
 * `/admin` write (ADR 0033).
 *
 * Revoking it from an admin is accepted and stores `false`, but changes
 * nothing: `isTesterUser` reads an admin as a tester regardless. The page says
 * so rather than refusing the write, because refusing would make a uniform row
 * of toggles behave differently for one row with no explanation on screen.
 */
export const setTesterRole = mutation({
    args: { userId: v.id("users"), isTester: v.boolean() },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const target = await ctx.db.get(args.userId);
        if (!target) throw new Error("User not found");
        await ctx.db.patch(args.userId, { isTester: args.isTester });
        return null;
    },
});
