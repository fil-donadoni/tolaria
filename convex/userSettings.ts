import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { auth, getCurrentUserId } from "./auth";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Per-user Settings (issue #2595, PRD #2405 slice 16/16, ADR 0101): density,
 * motion, phase stops (a pre-existing localStorage store this module does
 * NOT touch — `src/lib/skip-phase-prefs.ts` stays the single source of truth
 * for that one) and the Oracle/Printed preview default. One row per user;
 * `getUserSettings` returns `null` for a user who has never saved (the
 * client applies the same hard-coded defaults it always used), and
 * `updateUserSettings` upserts a partial patch so the settings page can save
 * one field at a time without clobbering the others.
 *
 * The `query`/`mutation` handlers below stay thin passthroughs to the two
 * exported pure functions (`projectUserSettings`, `resolveUserSettingsWrite`)
 * — the project has no `convex-test` harness (see `convex/__tests__/decks.test.ts`'s
 * header note), so business logic is kept in plain functions the test file
 * drives directly, mirroring `decks.ts`'s `presetToInsert`/`buildPresetPatch`.
 */

export type DensityPreference = "compact" | "comfortable" | "roomy";
export type MotionPreference = "system" | "reduced";
export type PreviewPreference = "computed" | "printed";

export type UserSettingsPatch = {
    density?: DensityPreference;
    motion?: MotionPreference;
    previewPreference?: PreviewPreference;
};

const densityValidator = v.union(
    v.literal("compact"),
    v.literal("comfortable"),
    v.literal("roomy")
);
const motionValidator = v.union(v.literal("system"), v.literal("reduced"));
const previewPreferenceValidator = v.union(
    v.literal("computed"),
    v.literal("printed")
);

const userSettingsValidator = v.object({
    density: v.optional(densityValidator),
    motion: v.optional(motionValidator),
    previewPreference: v.optional(previewPreferenceValidator),
});

/** Strips `_id`/`_creationTime`/`userId` off a stored row down to the wire
 *  shape `getUserSettings` returns — `null` in, `null` out (a user who has
 *  never saved). Pure so it is unit-testable without a real Convex `ctx`. */
export function projectUserSettings(
    row: Doc<"userSettings"> | null
): UserSettingsPatch | null {
    if (!row) return null;
    return {
        density: row.density,
        motion: row.motion,
        previewPreference: row.previewPreference,
    };
}

/** Decides whether `updateUserSettings` patches the caller's existing row or
 *  inserts a new one, and what either write looks like. Pure — the mutation
 *  handler supplies only `ctx.db` I/O around this decision. */
export function resolveUserSettingsWrite(
    existing: Doc<"userSettings"> | null,
    userId: Id<"users">,
    patch: UserSettingsPatch
):
    | { kind: "patch"; id: Id<"userSettings">; patch: UserSettingsPatch }
    | { kind: "insert"; row: UserSettingsPatch & { userId: Id<"users"> } } {
    if (existing) return { kind: "patch", id: existing._id, patch };
    return { kind: "insert", row: { userId, ...patch } };
}

export const getUserSettings = query({
    args: {},
    returns: v.union(userSettingsValidator, v.null()),
    handler: async (ctx) => {
        const userId = await auth.getUserId(ctx);
        if (!userId) return null;
        const row = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique();
        return projectUserSettings(row);
    },
});

export const updateUserSettings = mutation({
    args: {
        density: v.optional(densityValidator),
        motion: v.optional(motionValidator),
        previewPreference: v.optional(previewPreferenceValidator),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const userId = await getCurrentUserId(ctx);
        const existing = await ctx.db
            .query("userSettings")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .unique();
        const write = resolveUserSettingsWrite(existing, userId, args);
        if (write.kind === "patch") {
            await ctx.db.patch(write.id, write.patch);
        } else {
            await ctx.db.insert("userSettings", write.row);
        }
        return null;
    },
});
