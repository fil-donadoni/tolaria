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
    scenarioSpecValidator,
    selectEphemeralIdsToPrune,
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
 * Promote a scenario to "golden" (keep) or demote it back to ephemeral (issue
 * #772, ADR 0044). Golden rows survive `cleanupEphemeralScenarios`; ephemeral
 * rows are prunable. Promoting stamps the current `schemaVersion` (the drift tag
 * a long-lived curated row is checked against); demoting clears it, since only
 * golden rows carry the tag. Admin-gated and ownership-enforced — a row owned by
 * another user is treated as not found.
 */
export const setDebugScenarioGolden = mutation({
    args: { id: v.id("debugScenarios"), golden: v.boolean() },
    returns: v.null(),
    handler: async (ctx, args) => {
        const user = await assertIsAdmin(ctx);
        const row = await ctx.db.get(args.id);
        if (!row || row.userId !== user._id) {
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
 * Prune the current admin's EPHEMERAL scenarios past a bound (issue #772, ADR
 * 0044). Golden rows are never removed; non-golden rows are kept newest-first up
 * to `keep`, and everything older is deleted. This is the "relocate the too-many-
 * scenarios problem into the DB on purpose" cleanup — bounded and deletable,
 * which the old code array never was. Admin-gated and scoped to the caller's own
 * rows. Returns the number pruned.
 */
export const cleanupEphemeralScenarios = mutation({
    args: { keep: v.optional(v.number()) },
    returns: v.object({ pruned: v.number() }),
    handler: async (ctx, args) => {
        const user = await assertIsAdmin(ctx);
        const rows = await ctx.db
            .query("debugScenarios")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .collect();
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
 * Re-runs the admin gate AND enforces ownership so the action can't read another
 * user's row. Returns `null` when the row is missing, not owned, or has no
 * prompt (a hand-authored row without one can't be regenerated).
 */
export const getScenarioPromptForRegen = internalQuery({
    args: { id: v.id("debugScenarios") },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, args) => {
        const user = await assertIsAdmin(ctx);
        const row = await ctx.db.get(args.id);
        if (!row || row.userId !== user._id) return null;
        return row.prompt ?? null;
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
    {
        // Phyrexian mana ({X/P} = pay 2 life, CR 107.4f). Cast Gitaxian Probe
        // with NO blue mana up — the {U/P} is paid with 2 life (golden path).
        // Dismember ({1}{B/P}{B/P}) shows the mix: the {1} taps a land while the
        // two {B/P} are paid with 4 life, wiping the opponent's Craw Wurm with
        // -5/-5. Phyrexian Metamorph ({3}{U/P}) enters as a copy of a creature,
        // its pip paid with mana or life. landCount 4 funds the generic pips.
        label: "Phyrexian mana — pay life for {X/P} pips",
        spec: {
            cards: [
                { name: "Gitaxian Probe", owner: "me", zone: "hand" },
                { name: "Dismember", owner: "me", zone: "hand" },
                { name: "Phyrexian Metamorph", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Landfall (CR 603.6a — "a land you control enters", issue #694).
        // Bristly Bill, Spine Sower is on the battlefield next to a Grizzly
        // Bears. Play a Forest from hand: the Landfall trigger goes on the
        // stack and, on resolution, lets you put a +1/+1 counter on target
        // creature (golden path). Then, with the lands up, activate
        // "{3}{G}{G}: Double the number of +1/+1 counters on each creature you
        // control" to feel the payoff (edge case — the DSL activated ability).
        label: "Landfall — Bristly Bill grows the team on each land drop",
        spec: {
            cards: [
                {
                    name: "Bristly Bill, Spine Sower",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 5,
        },
    },
    {
        // Energy (CR 122.1 — the {E} resource, Cube CAP #697). Two Galvanic
        // Discharges in hand and two opposing Grizzly Bears to zap. Cast the
        // first Discharge on a Bears: "you get {E}{E}{E}, then you may pay any
        // amount of {E}" — pay 1 or 2 and watch the energy badge appear under
        // your name with the leftover (golden path: get → pay → damage). Then
        // cast the SECOND Discharge: it gets you three MORE {E}, so the pay
        // range now spans the whole ACCUMULATED pool (leftover + 3) — the edge
        // case showing energy is a persistent, stacking player resource.
        label: "Energy — Galvanic Discharge: get {E}{E}{E}, pay any amount",
        spec: {
            cards: [
                { name: "Galvanic Discharge", owner: "me", zone: "hand" },
                { name: "Galvanic Discharge", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Madness (CR 702.35 — the discard→exile cast capability, Cube CAP
        // #698). Cast Faithless Looting ("draw two, then discard two") and
        // discard Basking Rootwalla + Anje's Ravager: instead of hitting the
        // graveyard, each is exiled and offered for its MADNESS cost. Cast
        // Basking Rootwalla for {0} (golden path — free), and Anje's Ravager for
        // its Madness {1}{R} (not its printed {2}{R}) from exile at instant
        // speed. Edge case (decline): leave a discarded copy in exile and pass
        // to the end of the turn — at cleanup it is put into your graveyard
        // (CR 702.35d "if you don't, put it into your graveyard").
        label: "Madness — discard into exile, then cast for the madness cost",
        spec: {
            cards: [
                { name: "Faithless Looting", owner: "me", zone: "hand" },
                { name: "Basking Rootwalla", owner: "me", zone: "hand" },
                { name: "Anje's Ravager", owner: "me", zone: "hand" },
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
                // Curated presets are golden → carry the drift tag (issue #772).
                schemaVersion: SCENARIO_SCHEMA_VERSION,
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
