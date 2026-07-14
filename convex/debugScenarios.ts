import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { assertIsAdmin } from "./auth";
import { tryGetCardByName } from "./cards";
import {
    collectUnresolvedCardNames,
    normalizeScenarioSpec,
    scenarioSpecValidator,
    type ScenarioSpec,
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

// ---- One-off migration: PRESET_SCENARIOS code literal → DB rows (issue #770) --

/**
 * The historical `PRESET_SCENARIOS` entries (formerly
 * `src/lib/presetScenarios.ts`, now deleted — this migration is the last place
 * their content lives in code). Frozen as of the migration; a scenario added
 * after this point is authored straight into the DB (`saveDebugScenario` /
 * `DebugDbScenarios`), never appended here.
 */
const MIGRATED_PRESET_SCENARIOS: { label: string; spec: ScenarioSpec }[] = [
    {
        // Wild Growth — triggered mana ability (CR 605.1b / 605.4). Tapping the
        // enchanted Forest for mana fires Wild Growth's tap trigger, which
        // resolves IMMEDIATELY off the stack: the bonus {G} appears in the pool
        // in the same click, with no stack item and no priority pass. Cast the
        // Craw Wurm ({4}{G}{G}) with fewer lands than its cost to feel it — the
        // extra {G} is there while you pay, not one pass later.
        label: "Wild Growth — bonus mana resolves off the stack",
        spec: {
            cards: [
                { name: "Forest", owner: "me", zone: "battlefield" },
                {
                    name: "Wild Growth",
                    owner: "me",
                    zone: "battlefield",
                    attachedTo: "Forest",
                },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
];

/**
 * One-shot migration (issue #770, ADR 0044): insert the frozen
 * `MIGRATED_PRESET_SCENARIOS` as `debugScenarios` rows owned by `userId`,
 * flagged `golden` (curated, keep). Idempotent by label — a label already
 * present for that user is skipped, so re-running (e.g. against a second admin)
 * never duplicates rows. `internalMutation`: no `assertIsAdmin` call, since it
 * is reachable only via the Convex dashboard / `npx convex run` with deploy
 * access, never from a client. Run once per admin who wants the historical
 * presets available in their panel, e.g.:
 * `npx convex run debugScenarios:seedPresetScenarios '{"userId":"<id>"}'`
 */
export const seedPresetScenarios = internalMutation({
    args: { userId: v.id("users") },
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("debugScenarios")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .collect();
        const existingLabels = new Set(existing.map((row) => row.label));

        let inserted = 0;
        let skipped = 0;
        for (const preset of MIGRATED_PRESET_SCENARIOS) {
            if (existingLabels.has(preset.label)) {
                skipped++;
                continue;
            }
            await ctx.db.insert("debugScenarios", {
                userId: args.userId,
                label: preset.label,
                spec: preset.spec,
                golden: true,
                createdAt: Date.now(),
            });
            inserted++;
        }
        return { inserted, skipped };
    },
});

// Exported for tests only — proves the frozen migration data itself is
// loadable (every card name resolves, matches `scenarioSpecValidator`)
// without spinning up a Convex test harness.
export { MIGRATED_PRESET_SCENARIOS };
