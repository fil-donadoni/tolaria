import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { assertIsAdmin } from "./auth";
import { tryGetCardByName } from "./cards";
import {
    collectUnresolvedCardNames,
    normalizeScenarioSpec,
    scenarioSpecValidator,
} from "./debugScenarioSpec";

// Debug scenarios (issue #769, ADR 0044). The tracer-bullet DB path: a preset
// board state — the *argument* to the unchanged `debugSetupScenario` builder
// (`convex/game.ts`) — lives as a row in `debugScenarios` instead of the
// `PRESET_SCENARIOS` code literal. Every function here is `assertIsAdmin`-gated,
// inheriting the same gate that guards the builder (issue #768): no new
// state-mutation surface is exposed to non-admin players.

/**
 * List the current admin's saved debug scenarios, newest first. `assertIsAdmin`
 * runs FIRST — a non-admin caller is rejected before any row is read.
 */
export const listDebugScenarios = query({
    args: {},
    handler: async (ctx) => {
        const user = await assertIsAdmin(ctx);
        return await ctx.db
            .query("debugScenarios")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .order("desc")
            .collect();
    },
});

/**
 * Save a debug scenario spec as a row scoped to the current admin. Card names
 * are validated up front (ADR 0044): a spec referencing a name that doesn't
 * resolve in the catalogue is REJECTED before write, with the offending names in
 * the error, so a bad row never reaches the load path to corrupt a board.
 */
export const saveDebugScenario = mutation({
    args: {
        label: v.string(),
        spec: scenarioSpecValidator,
        // Reserved for later slices (#770+); accepted but optional.
        golden: v.optional(v.boolean()),
        prompt: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = await assertIsAdmin(ctx);
        const label = args.label.trim() || "Untitled scenario";

        // Loadability guard (ADR 0044): reject before write if any referenced
        // card name (placement, aura host, copy source) is unknown.
        const unresolved = collectUnresolvedCardNames(
            args.spec,
            (name) => tryGetCardByName(name) !== null
        );
        if (unresolved.length > 0) {
            throw new Error(
                `Unknown card name(s): ${unresolved.join(", ")}`
            );
        }

        return await ctx.db.insert("debugScenarios", {
            userId: user._id,
            label,
            spec: args.spec,
            golden: args.golden,
            prompt: args.prompt,
            createdAt: Date.now(),
        });
    },
});

/**
 * Delete one of the current admin's debug scenarios. Ownership is enforced: a
 * row belonging to another user is treated as not found (never deletable across
 * users).
 */
export const deleteDebugScenario = mutation({
    args: { id: v.id("debugScenarios") },
    handler: async (ctx, args) => {
        const user = await assertIsAdmin(ctx);
        const row = await ctx.db.get(args.id);
        if (!row || row.userId !== user._id) {
            throw new Error("Scenario not found");
        }
        await ctx.db.delete(args.id);
        return null;
    },
});

// Re-exported so the frontend load path can tolerantly normalize a stored spec
// before handing it to `debugSetupScenario` (unknown fields dropped, missing
// defaulted). Keeps the tolerant-load logic in one place (ADR 0044).
export { normalizeScenarioSpec };
