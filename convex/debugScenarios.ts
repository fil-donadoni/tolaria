import { v } from "convex/values";
import {
    internalMutation,
    internalQuery,
    mutation,
    query,
} from "./_generated/server";
import { assertIsAdmin } from "./auth";
import { tryGetCardByName } from "./cards";
import {
    collectUnresolvedCardNames,
    normalizeScenarioSpec,
    resolveScenarioGolden,
    scenarioSpecValidator,
    selectEphemeralIdsToPrune,
    selectScenarioUpsert,
    SCENARIO_SCHEMA_VERSION,
    type ScenarioSpec,
} from "./debugScenarioSpec";

// Debug scenarios (issue #769, ADR 0044). The tracer-bullet DB path: a preset
// board state — the *argument* to the unchanged `debugSetupScenario` builder
// (`convex/game.ts`) — lives as a row in `debugScenarios` instead of the
// `PRESET_SCENARIOS` code literal. Every function here is `assertIsAdmin`-gated,
// inheriting the same gate that guards the builder (issue #768): no new
// state-mutation surface is exposed to non-admin players.

/**
 * List ALL saved debug scenarios, newest first. Debug scenarios are a SHARED
 * admin tool: every admin sees (and can load/edit/delete) every scenario,
 * regardless of which admin created it — `userId` is retained only as authorship
 * provenance. `assertIsAdmin` runs FIRST — a non-admin caller is rejected before
 * any row is read.
 */
export const listDebugScenarios = query({
    args: {},
    handler: async (ctx) => {
        await assertIsAdmin(ctx);
        // Admin-only debug tool; the table is kept small by
        // `cleanupEphemeralScenarios`. Bound the scan defensively.
        return await ctx.db.query("debugScenarios").order("desc").take(500);
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
            throw new Error(`Unknown card name(s): ${unresolved.join(", ")}`);
        }

        return await ctx.db.insert("debugScenarios", {
            userId: user._id,
            label,
            spec: args.spec,
            golden: args.golden,
            prompt: args.prompt,
            // Only golden rows carry the schema-drift tag (issue #772, ADR 0044).
            schemaVersion:
                args.golden === true ? SCENARIO_SCHEMA_VERSION : undefined,
            createdAt: Date.now(),
        });
    },
});

/**
 * Update an existing scenario's label + spec in place (edit an existing row).
 * Scenarios are a SHARED admin tool: ANY admin may edit ANY scenario. The same
 * loadability guard as `saveDebugScenario` runs before write, so an edit can't
 * introduce an unknown card name. `golden`/`prompt`/`schemaVersion` are left
 * untouched — editing the board doesn't change a row's keep status or its
 * regenerate provenance.
 */
export const updateDebugScenario = mutation({
    args: {
        id: v.id("debugScenarios"),
        label: v.string(),
        spec: scenarioSpecValidator,
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const row = await ctx.db.get(args.id);
        if (!row) {
            throw new Error("Scenario not found");
        }
        const unresolved = collectUnresolvedCardNames(
            args.spec,
            (name) => tryGetCardByName(name) !== null
        );
        if (unresolved.length > 0) {
            throw new Error(`Unknown card name(s): ${unresolved.join(", ")}`);
        }
        await ctx.db.patch(args.id, {
            label: args.label.trim() || "Untitled scenario",
            spec: args.spec,
        });
        return null;
    },
});

/**
 * Promote a scenario to "golden" (keep) or demote it back to ephemeral (issue
 * #772, ADR 0044). Golden rows survive `cleanupEphemeralScenarios`; ephemeral
 * rows are prunable. Promoting stamps the current `schemaVersion` (the drift tag
 * a long-lived curated row is checked against); demoting clears it, since only
 * golden rows carry the tag. Admin-gated; ANY admin may promote/demote ANY
 * scenario (shared tool).
 */
export const setDebugScenarioGolden = mutation({
    args: { id: v.id("debugScenarios"), golden: v.boolean() },
    returns: v.null(),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const row = await ctx.db.get(args.id);
        if (!row) {
            throw new Error("Scenario not found");
        }
        await ctx.db.patch(args.id, {
            golden: args.golden,
            schemaVersion: args.golden ? SCENARIO_SCHEMA_VERSION : undefined,
        });
        return null;
    },
});

/**
 * Prune the SHARED EPHEMERAL scenarios past a bound (issue #772, ADR 0044).
 * Golden rows are never removed; non-golden rows are kept newest-first up to
 * `keep`, and everything older is deleted. This is the "relocate the too-many-
 * scenarios problem into the DB on purpose" cleanup — bounded and deletable,
 * which the old code array never was. Admin-gated; operates on the shared pool
 * (all admins' scenarios). Returns the number pruned.
 */
export const cleanupEphemeralScenarios = mutation({
    args: { keep: v.optional(v.number()) },
    returns: v.object({ pruned: v.number() }),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const rows = await ctx.db
            .query("debugScenarios")
            .order("desc")
            .take(500);
        const toPrune = selectEphemeralIdsToPrune(rows, args.keep);
        for (const id of toPrune) {
            await ctx.db.delete(id);
        }
        return { pruned: toPrune.length };
    },
});

/**
 * Read a scenario's stored prompt for the regenerate/vary action (issue #772,
 * ADR 0044). `internalQuery` — reachable only from the server-side
 * `regenerateDebugScenario` action (which has no `ctx.db`), never from a client.
 * Re-runs the admin gate; scenarios are shared, so any admin may regenerate any
 * row. Returns `null` when the row is missing or has no prompt (a hand-authored
 * row without one can't be regenerated).
 */
export const getScenarioPromptForRegen = internalQuery({
    args: { id: v.id("debugScenarios") },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const row = await ctx.db.get(args.id);
        if (!row) return null;
        return row.prompt ?? null;
    },
});

/**
 * Delete a debug scenario. Scenarios are a SHARED admin tool: ANY admin may
 * delete ANY scenario.
 */
export const deleteDebugScenario = mutation({
    args: { id: v.id("debugScenarios") },
    handler: async (ctx, args) => {
        await assertIsAdmin(ctx);
        const row = await ctx.db.get(args.id);
        if (!row) {
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

/**
 * Write ONE debug scenario row straight to the DB (issue #1453; design doc
 * `docs/superpowers/specs/2026-07-21-db-direct-debug-scenarios-design.md`).
 * This is the DB-direct write path for registering a scenario: once a
 * card/mechanic's branch has merged and the deployment redeployed (so the
 * card exists in the catalogue the loadability guard below checks against),
 * the orchestrator registers the scenario by calling this mutation directly —
 * `npx convex run debugScenarios:seedScenarioDirect '{"label":"...","spec":{...}}'`
 * or via the Convex MCP.
 *
 * `internalMutation`: reachable only with deploy access (dashboard /
 * `npx convex run` / MCP), never from a client — so unlike `saveDebugScenario`
 * it does NOT gate on `assertIsAdmin`. There is no caller identity to check;
 * the access control is "can you run internal mutations against this
 * deployment at all."
 *
 * **Upsert-by-label** (`selectScenarioUpsert`): re-running with the same
 * `label` PATCHES the existing row's `spec` (and `golden`/`prompt` if
 * explicitly provided) instead of accumulating a duplicate row.
 *
 * **Accepted tradeoff** (design doc): the written row is DEPLOYMENT-LOCAL —
 * not captured in git, so it does not reproduce on a fresh clone, in CI, or
 * on a different deployment. That is the tradeoff of a DB-direct write: a
 * scenario stops needing a file edit + merge-train append-conflict to
 * register.
 */
export const seedScenarioDirect = internalMutation({
    args: {
        label: v.string(),
        spec: scenarioSpecValidator,
        golden: v.optional(v.boolean()),
        prompt: v.optional(v.string()),
    },
    returns: v.object({
        action: v.union(v.literal("insert"), v.literal("patch")),
        id: v.id("debugScenarios"),
    }),
    handler: async (ctx, args) => {
        const label = args.label.trim() || "Untitled scenario";

        // Loadability guard reused (ADR 0044), same as saveDebugScenario:
        // reject before write if any referenced card name doesn't resolve in
        // the catalogue, with the offending name(s) in the error.
        const unresolved = collectUnresolvedCardNames(
            args.spec,
            (name) => tryGetCardByName(name) !== null
        );
        if (unresolved.length > 0) {
            throw new Error(`Unknown card name(s): ${unresolved.join(", ")}`);
        }

        // Bounded scan, same style as the other seed paths above — the table
        // is kept small by `cleanupEphemeralScenarios`.
        const existing = await ctx.db.query("debugScenarios").take(1000);
        const decision = selectScenarioUpsert(existing, label);

        if (decision.action === "patch") {
            const patch: {
                spec: ScenarioSpec;
                golden?: boolean;
                prompt?: string;
                schemaVersion?: number;
            } = { spec: args.spec };
            if (args.golden !== undefined) {
                patch.golden = args.golden;
                patch.schemaVersion = args.golden
                    ? SCENARIO_SCHEMA_VERSION
                    : undefined;
            }
            if (args.prompt !== undefined) {
                patch.prompt = args.prompt;
            }
            await ctx.db.patch(decision.id, patch);
            return { action: "patch" as const, id: decision.id };
        }

        const golden = resolveScenarioGolden(args.golden);
        const id = await ctx.db.insert("debugScenarios", {
            label,
            spec: args.spec,
            golden,
            prompt: args.prompt,
            schemaVersion: golden ? SCENARIO_SCHEMA_VERSION : undefined,
            createdAt: Date.now(),
        });
        return { action: "insert" as const, id };
    },
});
