import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ResendOTPPasswordReset } from "./resendOtpPasswordReset";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";

type AnyCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;

function normalizeNickname(raw: unknown): string {
    if (typeof raw !== "string") {
        throw new Error("nickname is required");
    }
    const trimmed = raw.trim();
    if (trimmed.length < NICKNAME_MIN || trimmed.length > NICKNAME_MAX) {
        throw new Error(
            `nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters`
        );
    }
    return trimmed;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
    providers: [
        Password({
            // Turns on `flow: "reset"` / `flow: "reset-verification"`: an
            // 8-digit OTP mailed by Resend. See
            // `convex/resendOtpPasswordReset.ts` for the required deployment
            // env vars (RESEND_API_KEY, SITE_URL).
            reset: ResendOTPPasswordReset,
            profile(params) {
                const email = params.email;
                if (typeof email !== "string" || email.trim().length === 0) {
                    throw new Error("email is required");
                }
                const normalizedEmail = email.trim().toLowerCase();
                // Password provider invokes `profile()` on EVERY flow —
                // signUp, signIn, reset and reset-verification. Nickname is
                // required only at sign-up; on every other flow the existing
                // user record already has it and params.nickname is
                // undefined. The reset flows carry only `email`, which is
                // what looks the account up.
                const out: Record<string, string> = {
                    email: normalizedEmail,
                };
                if (params.flow === "signUp") {
                    out.nickname = normalizeNickname(params.nickname);
                }
                return out as { email: string; nickname: string };
            },
        }),
    ],
});

export async function getCurrentUserId(ctx: AnyCtx): Promise<Id<"users">> {
    const userId = await auth.getUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return userId;
}

export async function getCurrentUser(ctx: AnyCtx): Promise<Doc<"users">> {
    const userId = await getCurrentUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");
    return user;
}

/**
 * Pure admin predicate (PRD #466, ADR 0033). Decides whether a loaded user
 * doc is an admin: a missing user is rejected; the `isAdmin` flag must be
 * explicitly `true`. Extracted from `assertIsAdmin` so it is unit-testable
 * without a Convex harness (the project has no convex-test harness).
 */
export function isAdminUser(user: Doc<"users"> | null): boolean {
    return user?.isAdmin === true;
}

/**
 * Server-side admin gate (ADR 0033). Loads the current user and throws unless
 * they are flagged `isAdmin`. Hiding the editor controls in the UI is cosmetic
 * only — every admin-gated mutation MUST call this FIRST. Returns the user doc
 * for callers that need it.
 */
export async function assertIsAdmin(ctx: AnyCtx): Promise<Doc<"users">> {
    const userId = await auth.getUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!isAdminUser(user)) {
        throw new Error("Forbidden: admin only");
    }
    // `isAdminUser` guarantees user is non-null here.
    return user as Doc<"users">;
}

/**
 * Admin gate callable from an `action` (issue #1143). Actions have no
 * `ctx.db`, so `assertIsAdmin` can't run inline in one — an action reaches it
 * via `ctx.runQuery(internal.auth.requireAdminQuery, {})`, which propagates
 * the calling user's identity into this internal query. Throws (mirroring
 * `assertIsAdmin`) for a non-admin/unauthenticated caller; the thrown error
 * surfaces back through the action to the client. `syncBanlist`
 * (`convex/banlistSync.ts`) is the first consumer.
 */
export const requireAdminQuery = internalQuery({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        return null;
    },
});
