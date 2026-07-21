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
    selectPresetsToSeed,
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
        // Tombstone the label (issue #1422): a hard-deleted scenario's label is
        // remembered so `seedNewMechanicScenarios` won't re-insert it on the next
        // deploy. Idempotent — only insert a tombstone if this label isn't
        // already tombstoned. Manual `saveDebugScenario` is unaffected: it does
        // NOT consult tombstones, so re-saving the same label still works.
        const existingTombstone = await ctx.db
            .query("debugScenarioTombstones")
            .withIndex("by_label", (q) => q.eq("label", row.label))
            .first();
        if (!existingTombstone) {
            await ctx.db.insert("debugScenarioTombstones", {
                label: row.label,
                createdAt: Date.now(),
            });
        }
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
    {
        // Exalted (CR 702.83 — the attack-alone buff keyword, Cube CAP #699).
        // Noble Hierarch (exalted) stands next to two Grizzly Bears. Move to
        // combat and attack with ONE Bears: the exalted trigger fires and that
        // lone attacker gets +1/+1 (2/2 → 3/3) until end of turn (golden path).
        // Edge case: attack with BOTH Bears instead — no creature attacked
        // ALONE, so exalted does not trigger and neither is pumped. (A second
        // Noble Hierarch would stack the buff; one is enough to feel it.)
        label: "Exalted — Noble Hierarch buffs the lone attacker",
        spec: {
            cards: [
                { name: "Noble Hierarch", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
];

/**
 * One-shot migration (issue #770, ADR 0044): insert the frozen
 * `MIGRATED_PRESET_SCENARIOS` as ownerless `golden` `debugScenarios` rows
 * (curated, keep). Idempotent by label — a label already present in the pool is
 * skipped, so re-running never duplicates rows. Scenarios are shared across all
 * admins, so no `userId` arg is needed. `internalMutation`: no `assertIsAdmin`
 * call, since it is reachable only via the Convex dashboard / `npx convex run`
 * with deploy access, never from a client. Run once after deploy:
 * `npx convex run debugScenarios:seedPresetScenarios`
 */
export const seedPresetScenarios = internalMutation({
    args: {},
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx) => {
        // Ownerless golden seed, deduped pool-wide by label — see
        // `seedNewMechanicScenarios`.
        const existing = await ctx.db.query("debugScenarios").take(1000);
        const existingLabels = new Set(existing.map((row) => row.label));

        let inserted = 0;
        let skipped = 0;
        for (const preset of MIGRATED_PRESET_SCENARIOS) {
            if (existingLabels.has(preset.label)) {
                skipped++;
                continue;
            }
            await ctx.db.insert("debugScenarios", {
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

// ---- New-mechanic scenarios — the ONGOING agent-authored append point --------

/**
 * Golden manual-test scenarios for cards & mechanics shipped after the #770
 * migration. **This is the ongoing, append-only registration point** for every
 * new card/mechanic scenario: an agent (`/process-gh-issues`) or human author
 * appends one `{ label, spec }` here rather than the frozen
 * `MIGRATED_PRESET_SCENARIOS` list above. It is code-tracked on purpose — a
 * headless subagent has no Debug panel and cannot run `saveDebugScenario`, so
 * the code path is the only automatable one (CLAUDE.md § Development cycle
 * step 7). The merge-train absorbs the trivial append-conflict, same as any
 * other append-only registration point. Seed the rows into the DB with:
 * `npx convex run debugScenarios:seedNewMechanicScenarios '{"userId":"<id>"}'`
 */
const NEW_MECHANIC_SCENARIOS: { label: string; spec: ScenarioSpec }[] = [
    {
        // Storm (CR 702.40, issue #1042). Cast the two free Gitaxian Probes and
        // the Brainstorm FIRST to raise the spells-cast-this-turn count, THEN
        // cast Grapeshot / Tendrils / Brain Freeze / Empty the Warrens: each is
        // copied once per spell cast before it this turn (the copies need no
        // target re-choice for Empty the Warrens' tokens; the targeted ones ask
        // per copy). Golden path: 3 prior spells → Grapeshot deals 4 total.
        label: "Storm — build the count, then Grapeshot/Tendrils copy per prior spell",
        spec: {
            cards: [
                { name: "Gitaxian Probe", owner: "me", zone: "hand", count: 2 },
                { name: "Brainstorm", owner: "me", zone: "hand" },
                { name: "Grapeshot", owner: "me", zone: "hand" },
                { name: "Tendrils of Agony", owner: "me", zone: "hand" },
                { name: "Brain Freeze", owner: "me", zone: "hand" },
                { name: "Empty the Warrens", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 7,
        },
    },
    {
        // Brainstorm put-back Op (issue #1046 / #1218). Draw three, then choose
        // an order to put two cards back on top of the library — the suspending
        // "put N hand cards on top in any order" Op. Golden path: cast
        // Brainstorm, pick two hand cards, order them, confirm; the next draw
        // pulls the top one you chose. Grizzly Bears seeded on top of the
        // library so the drawn-then-returned cards are recognizable.
        label: "Brainstorm — draw 3, put 2 back on top in chosen order",
        spec: {
            cards: [
                { name: "Brainstorm", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "library",
                    position: 0,
                },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Recoil — owner-vs-controller discard (`.owner` EffectPlayerRef, issue
        // #1106). Return a permanent to its OWNER's hand, then THAT player (the
        // owner, not Recoil's controller) discards a card. Golden path: target
        // the opponent's Grizzly Bears — it bounces to the opp's hand and the
        // OPP discards, even though you cast Recoil. Two spare cards in the
        // opp's hand so the discard has something to hit.
        label: "Recoil — bounce to owner's hand, that player (owner) discards",
        spec: {
            cards: [
                { name: "Recoil", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "hand", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 5,
        },
    },
    {
        // Toxic Deluge — signed/negative X EffectValue for pump Ops (issue
        // #926). Pay X life on resolution; every creature gets -X/-X until end
        // of turn (a negative pump, not destroy — indestructible dies anyway).
        // Golden path: X=2 wipes both 2/2 Grizzly Bears; your own Craw Wurm
        // (6/4) survives at 4/2. Edge: X=4 to see your board die with theirs.
        label: "Toxic Deluge — pay X life, all creatures get -X/-X",
        spec: {
            cards: [
                { name: "Toxic Deluge", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
                { name: "Craw Wurm", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Viridian Joiner — mana ability amount reads the source's EFFECTIVE
        // power, layers-aware (issue #927). It taps for {G} equal to its power;
        // with two +1/+1 counters it is a 3/4, so it taps for {G}{G}{G}, not
        // {G}. Golden path: tap it, then cast Craw Wurm ({4}{G}{G}) with only
        // two other lands — the extra green from its boosted power covers it.
        label: "Viridian Joiner — taps for {G} equal to its (boosted) power",
        spec: {
            cards: [
                {
                    name: "Viridian Joiner",
                    owner: "me",
                    zone: "battlefield",
                    counters: { "+1/+1": 2 },
                },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Evoke (CR 702.74, issue #900) — cast for the alternative evoke cost,
        // then sacrifice the creature when it enters. Grief's evoke exiles a
        // black card from hand (the spare Grief); Solitude's exiles a white card
        // (the spare Solitude). Golden path: evoke Grief → opp discards on ETB →
        // Grief is sacrificed; evoke Solitude → exiles the opp's Grizzly Bears →
        // Solitude is sacrificed. Two spare copies serve as the pitch fodder.
        label: "Evoke — Grief/Solitude for evoke cost, sacrifice on ETB",
        spec: {
            cards: [
                { name: "Grief", owner: "me", zone: "hand", count: 2 },
                { name: "Solitude", owner: "me", zone: "hand", count: 2 },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "hand", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Green Sun's Zenith — self-shuffle on resolution + dynamic
        // mana-value-ceiling search filter (issue #898). Search your library for
        // a green creature with mana value ≤ X, put it onto the battlefield,
        // THEN shuffle Green Sun's Zenith itself into your library. Golden path:
        // X=2 finds one of the seeded Grizzly Bears; note the GSZ card is not in
        // the graveyard afterward — it went back into the deck.
        label: "Green Sun's Zenith — fetch mv ≤ X creature, shuffle itself in",
        spec: {
            cards: [
                { name: "Green Sun's Zenith", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "library",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Survival of the Fittest — discard-card-matching-filter as an
        // ACTIVATION cost (issue #901). "{G}, discard a creature card: search
        // your library for a creature card, reveal it, put it into your hand,
        // then shuffle." The discard is part of the cost (only a CREATURE card
        // is a legal discard). Golden path: pay {G}, discard a Grizzly Bears
        // from hand, fetch a Craw Wurm from the library.
        label: "Survival of the Fittest — discard a creature (cost) to tutor one",
        spec: {
            cards: [
                {
                    name: "Survival of the Fittest",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Grizzly Bears", owner: "me", zone: "hand", count: 2 },
                { name: "Craw Wurm", owner: "me", zone: "library", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Discard-leg mayPay (issue #899) — an optional discard leg on a
        // MayPayCost. Formidable Speaker's effect offers "you may discard a
        // card"; taking the leg unlocks the conditional upside. Golden path:
        // cast it with spare cards in hand, ACCEPT the discard leg and watch the
        // conditional branch fire; edge: DECLINE and see the base branch.
        label: "Formidable Speaker — optional discard leg (mayPay)",
        spec: {
            cards: [
                { name: "Formidable Speaker", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Cube FREE — misc value/utility (issue #687). Aether Spellbomb: {1},
        // sacrifice → bounce target permanent, OR {U}, sacrifice → draw. Karakas:
        // {T} → return target LEGENDARY creature to its owner's hand. Golden
        // path: bounce the opp's Grizzly Bears with the Spellbomb, then tap
        // Karakas to bounce the opp's legendary Bristly Bill back to hand.
        label: "Cube FREE — Aether Spellbomb bounce/draw + Karakas legend bounce",
        spec: {
            cards: [
                { name: "Aether Spellbomb", owner: "me", zone: "battlefield" },
                { name: "Karakas", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
                {
                    name: "Bristly Bill, Spine Sower",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Improvise (CR 702.126, issue #1313). Metallic Rebuke ({2}{U}
        // Instant, "Improvise. Counter target spell unless its controller
        // pays {3}.") is the first card shipping the keyword now that
        // mechanicsRegistry.ts flips it to `status: "implemented"`. Golden
        // path: opp casts Grizzly Bears; me responds by casting Metallic
        // Rebuke, tapping the two untapped Millstones to pay the {2} generic
        // (game.ts tapArtifactForImprovise) and an Island for the {U},
        // countering the Bears unless opp pays {3}.
        label: "Improvise — Metallic Rebuke taps 2 Millstones to pay {2} of its cost",
        spec: {
            cards: [
                { name: "Metallic Rebuke", owner: "me", zone: "hand" },
                {
                    name: "Millstone",
                    owner: "me",
                    zone: "battlefield",
                    count: 2,
                },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Adapt N (CR 701.46, issue #1316, split from #917). Skitter Eel
        // ({3}{U} 3/3, "{2}{U}: Adapt 2.") is the prover card now that
        // mechanicsRegistry.ts flips Adapt to `status: "implemented"` — a
        // pure adapt user with no other ability, built with the
        // `adaptAbility` factory (convex/cards/abilities/adapt.ts). Two
        // copies exercise both halves of the CR 701.46a gate: the fresh eel
        // (no +1/+1 counters) gets two put on it when activated; the eel
        // that already carries one +1/+1 counter is a no-op ("if this
        // creature has NO +1/+1 counters" — one is not none). 6 Islands
        // cover activating both.
        label: "Adapt 2 — Skitter Eel with and without an existing +1/+1 counter",
        spec: {
            cards: [
                { name: "Skitter Eel", owner: "me", zone: "battlefield" },
                {
                    name: "Skitter Eel",
                    owner: "me",
                    zone: "battlefield",
                    counters: { "+1/+1": 1 },
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
        },
    },
    {
        // Phelia, Exuberant Shepherd — delayed-trigger controller/owner
        // branch (CR 603.7a, issue #1320, split from #917). "Whenever Phelia
        // attacks, exile up to one other target nonland permanent. At the
        // beginning of the next end step, return that card to the
        // battlefield under its owner's control. If it entered under your
        // control, put a +1/+1 counter on Phelia." Golden path: move to
        // combat, declare Phelia attacking, exile YOUR OWN Grizzly Bears —
        // it returns under YOUR control at the next end step, so Phelia gets
        // a +1/+1 counter. Edge case: on a later attack, exile the
        // opponent's Grizzly Bears instead — it returns under the
        // OPPONENT's control (its owner), so no counter is added even
        // though you (Phelia's controller) chose the target.
        label: "Phelia — attack, exile own permanent → returns under your control → +1/+1 counter",
        spec: {
            cards: [
                {
                    name: "Phelia, Exuberant Shepherd",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },

    // ---- Backfill: cards shipped 2026-07-15 → 18 (agent-authored, restore) ----
    {
        // Endurance — Evoke (CR 702.74) + ETB graveyard-to-bottom (issue #1207).
        // {1}{G}{G} 3/3 flash/reach Incarnation. Golden path: opp has a stocked
        // graveyard; evoke Endurance by exiling the spare green Endurance from
        // hand, then on ETB target the opponent — they shuffle their whole
        // graveyard onto the bottom of their library in random order, and
        // Endurance is sacrificed (evoke). Edge: hardcast it and target NO
        // player ("up to one") for a plain flash blocker. Two copies = the
        // pitch fodder; opp graveyard seeded so the bottom-move is visible.
        label: "Endurance — evoke (pitch a green card), ETB graveyard to bottom",
        spec: {
            cards: [
                { name: "Endurance", owner: "me", zone: "hand", count: 2 },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "graveyard",
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Fury — Evoke (CR 702.74) + targeted divide-as-you-choose ETB (CR
        // 601.2d/120.4, issue #1206). {3}{R}{R} 3/3 double strike Incarnation.
        // Golden path: evoke Fury by exiling the spare red Fury from hand; on
        // ETB assign 4 damage divided among 1-4 target creatures/planeswalkers
        // (split the 4 across the opp's two Grizzly Bears to kill both), then
        // Fury is sacrificed (evoke). Edge: hardcast for {3}{R}{R} and pile all
        // 4 onto one target. Two copies = the pitch fodder.
        label: "Fury — evoke (pitch a red card), ETB 4 damage divided",
        spec: {
            cards: [
                { name: "Fury", owner: "me", zone: "hand", count: 2 },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 5,
        },
    },
    {
        // Subtlety — Evoke (CR 702.74) + first targeted trigger over a SPELL on
        // the stack (CR 113, issue #1205). {2}{U}{U} 3/3 flash/flying. Golden
        // path: the opp casts Grizzly Bears (a creature spell now on the stack);
        // in response evoke Subtlety by exiling the spare blue Subtlety from
        // hand, target that creature spell — its owner (the opp) puts it on the
        // top or bottom of their library, and Subtlety is sacrificed (evoke).
        // Edge: hardcast and decline ("up to one") for a plain flash flyer.
        label: "Subtlety — evoke, bounce opp's creature spell top/bottom",
        spec: {
            cards: [
                { name: "Subtlety", owner: "me", zone: "hand", count: 2 },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Ignoble Hierarch — Exalted (CR 702.83) + choice mana ability (CR
        // 605.1a). {G} 0/1 mana dork, the Jund Noble Hierarch (issue #699).
        // Golden path: move to combat and attack with the lone Grizzly Bears —
        // exalted fires and the sole attacker gets +1/+1 (2/2 → 3/3) until end
        // of turn. Also: tap Ignoble Hierarch for your choice of {B}, {R}, or
        // {G} (a useStack:false mana ability). Edge: attack with BOTH creatures
        // — no lone attacker, so exalted does not trigger.
        label: "Ignoble Hierarch — exalted lone-attacker buff + choice mana",
        spec: {
            cards: [
                {
                    name: "Ignoble Hierarch",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Blazing Rootwalla — Madness {0} (CR 702.35) + once-per-turn pump (CR
        // 605). {R} 1/1 Lizard. Golden path: cast Faithless Looting, discard
        // Blazing Rootwalla to its draw-two/discard-two — it goes to exile via
        // madness, then you cast it for its {0} madness cost. Then activate the
        // battlefield copy's "{R}: +2/+0, once each turn" pump (1/1 → 3/1).
        // Edge: try to activate the pump twice — the second is blocked
        // (oncePerTurn). Faithless Looting = the discard outlet.
        label: "Blazing Rootwalla — madness {0} via Looting + once/turn pump",
        spec: {
            cards: [
                { name: "Blazing Rootwalla", owner: "me", zone: "hand" },
                { name: "Faithless Looting", owner: "me", zone: "hand" },
                {
                    name: "Blazing Rootwalla",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Dauthi Voidwalker — void-counter exile replacement (CR 614) + cast-
        // from-exile activated ability. {B}{B} 3/2 shadow. Golden path: cast
        // Lightning Bolt on the opp's Grizzly Bears — instead of dying to the
        // graveyard it is exiled with a void counter (opponent's card to an
        // opponent's graveyard). Then, at sorcery speed, {T} + sacrifice Dauthi:
        // choose that exiled Grizzly Bears and play it this turn without paying
        // its mana cost. Bolt = the removal that feeds the void exile.
        label: "Dauthi Voidwalker — void-counter exile, then cast it for free",
        spec: {
            cards: [
                {
                    name: "Dauthi Voidwalker",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Lightning Bolt", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 1,
        },
    },
    {
        // Guide of Souls — energy engine (issue #1194). {W} 1/2. Golden path:
        // cast the three Grizzly Bears one at a time — each "another creature
        // you control enters" trigger gains you 1 life and one {E}. With three
        // energy banked, move to combat and attack with Guide; pay {E}{E}{E} on
        // the attack trigger and target the attacking Guide — it gets two +1/+1
        // counters and a flying counter (which GRANTS flying, CR 613.4d) and
        // becomes an Angel (layer-4 type add). Edge: decline the mayPay to skip
        // the pump.
        label: "Guide of Souls — gain life + energy per creature, then pay {E}x3",
        spec: {
            cards: [
                {
                    name: "Guide of Souls",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                },
                { name: "Grizzly Bears", owner: "me", zone: "hand", count: 3 },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
        },
    },
    {
        // Malcolm, Alluring Scoundrel — chorus-counter loot + free cast at 4
        // (issue #1344). {1}{U} 2/1 flash/flying legend. Seeded with three
        // chorus counters. Golden path: move to combat and attack with Malcolm
        // (opp has no blockers) — combat damage adds the fourth chorus counter,
        // you draw a card then discard one, and because Malcolm now has four+
        // chorus counters you may cast that discarded card for free. Two spare
        // cards in hand give the loot something to discard.
        label: "Malcolm — 4th chorus counter, loot then cast discard for free",
        spec: {
            cards: [
                {
                    name: "Malcolm, Alluring Scoundrel",
                    owner: "me",
                    zone: "battlefield",
                    summoningSick: false,
                    counters: { chorus: 3 },
                },
                { name: "Grizzly Bears", owner: "me", zone: "hand", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 1,
        },
    },
    {
        // Ledger Shredder — connive on a player's SECOND spell each turn (CR
        // 701.50, per-player spell tally, issue #1343). {1}{U} 1/3 flying.
        // Golden path: cast the first Gitaxian Probe (free), then the second —
        // casting your second spell this turn triggers connive: draw a card,
        // discard a card, and because you discarded a nonland card put a +1/+1
        // counter on Ledger Shredder (1/3 → 2/4). Two Probes = the two spells;
        // a spare Grizzly Bears in hand is the nonland discard.
        label: "Ledger Shredder — second spell triggers connive (+1/+1 on nonland)",
        spec: {
            cards: [
                { name: "Ledger Shredder", owner: "me", zone: "battlefield" },
                { name: "Gitaxian Probe", owner: "me", zone: "hand", count: 2 },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Staff of the Storyteller — token→story-counter engine + draw sink
        // (issues #1302/#1345). {1}{W} Artifact, seeded with two story counters.
        // Golden path: activate "{W}, {T}, remove a story counter: draw a card"
        // to convert a story counter into a card. To see the front half, cast a
        // fresh Staff from hand instead: its ETB makes a 1/1 white flying Spirit
        // token, and "whenever you create one or more creature tokens" adds one
        // story counter (a batch of tokens still nets exactly one).
        label: "Staff of the Storyteller — remove story counter to draw",
        spec: {
            cards: [
                {
                    name: "Staff of the Storyteller",
                    owner: "me",
                    zone: "battlefield",
                    counters: { story: 2 },
                },
                { name: "Staff of the Storyteller", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Garruk Wildspeaker (CR 606 planeswalker loyalty abilities). Walker on
        // the battlefield seeds its printed loyalty 3. Golden path: +1 untaps
        // two tapped Forests, −1 makes a 3/3 Beast, −4 pumps your Grizzly Bears
        // +3/+3 & grants trample. Two tapped lands + a creature cover all three.
        label: "Garruk Wildspeaker — +1 untap two lands / −1 Beast token / −4 overrun",
        spec: {
            cards: [
                {
                    name: "Garruk Wildspeaker",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Forest",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                    count: 2,
                },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Liliana of the Veil (CR 606). Loyalty 3 auto-seeded. Golden path: +1
        // makes each player discard (both hands stocked), −2 forces the opponent
        // to sacrifice a creature (opp Grizzly Bears), −6 divides all the
        // opponent's permanents into two piles (divideIntoPiles, ADR 0053).
        label: "Liliana of the Veil — +1 mutual discard / −2 edict / −6 pile split",
        spec: {
            cards: [
                {
                    name: "Liliana of the Veil",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                {
                    name: "Forest",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Sorin, Lord of Innistrad (CR 606, emblem Op). Loyalty 3 auto-seeded.
        // Golden path: +1 makes a 1/1 lifelink Vampire, −2 gives the "+1/+0"
        // emblem, −6 destroys up to three opposing creatures (three opp Grizzly
        // Bears = a full up-to-3 group). Reanimation clause deferred (#1227).
        label: "Sorin, Lord of Innistrad — +1 Vampire / −2 emblem / −6 mass destroy",
        spec: {
            cards: [
                {
                    name: "Sorin, Lord of Innistrad",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Narset, Parter of Veils (CR 606 / 614 draw-lock, digToHand Op). Loyalty
        // 5 auto-seeded. Golden path: −2 looks at the top four of your library and
        // may take a noncreature, nonland card — Lightning Bolt seeded on top with
        // creature filler so the reveal has exactly one legal pick; the rest go to
        // the bottom. Static: each opponent can't draw a 2nd card this turn.
        label: "Narset, Parter of Veils — −2 dig top four (take Lightning Bolt) + draw-lock",
        spec: {
            cards: [
                {
                    name: "Narset, Parter of Veils",
                    owner: "me",
                    zone: "battlefield",
                },
                {
                    name: "Lightning Bolt",
                    owner: "me",
                    zone: "library",
                    position: 0,
                },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "library",
                    position: 1,
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Forth Eorlingas! (CR 720 monarch, delayedTrigger). Golden path: cast the
        // sorcery for X (landCount 6 → X=4), make four 2/2 trample+haste Human
        // Knights, attack the empty-boarded opponent; the delayed trigger fires on
        // combat damage to a player and you become the monarch (draw at end step).
        label: "Forth Eorlingas! — cast for X, hasty Knights swing, become the monarch",
        spec: {
            cards: [{ name: "Forth Eorlingas!", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
        },
    },
    {
        // Palace Jailer (CR 720 monarch, exileUntilMonarchChanges). Golden path:
        // cast the 2/2 (landCount 4); its first ETB makes you the monarch, its
        // second (targeted, CR 603.3d) exiles the opponent's Grizzly Bears until an
        // opponent becomes the monarch. Opp creature is the mandatory exile target.
        label: "Palace Jailer — ETB become monarch + exile opponent's creature",
        spec: {
            cards: [
                { name: "Palace Jailer", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Arwen, Mortal Queen (CR 122.1 counters, removeCounter cost). Seeded on the
        // battlefield with her one indestructible counter. Golden path: pay {1} +
        // remove the indestructible counter to give another target creature (Grizzly
        // Bears) indestructible EOT plus a +1/+1 and a lifelink counter, and put the
        // same pair on Arwen. Edge: spending her last counter splices indestructible
        // back off her (#1318).
        label: "Arwen, Mortal Queen — remove indestructible counter, empower another creature",
        spec: {
            cards: [
                {
                    name: "Arwen, Mortal Queen",
                    owner: "me",
                    zone: "battlefield",
                    counters: { indestructible: 1 },
                },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Torsten, Founder of Benalia (CR 603.2, digToHand + death token trigger).
        // Golden path: cast the 7/7 for X=5 (landCount 7); its ETB reveals the top
        // seven and lets you take any number of creature/land cards (Craw Wurms +
        // basics seeded on top), rest to the bottom. Edge: when Torsten dies it
        // makes seven 1/1 white Soldiers.
        label: "Torsten, Founder of Benalia — ETB dig top seven for creatures/lands",
        spec: {
            cards: [
                {
                    name: "Torsten, Founder of Benalia",
                    owner: "me",
                    zone: "hand",
                },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 0,
                    count: 3,
                },
                {
                    name: "Plains",
                    owner: "me",
                    zone: "library",
                    position: 3,
                    count: 4,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 7,
        },
    },
    {
        // Omnath, Locus of Creation (landfall, abilityResolutionCount if-ladder).
        // Golden path: Omnath on the battlefield, three Forests in hand to play in
        // succession — landfall #1 gains 4 life, #2 adds {R}{G}{W}{U}, #3 deals 4 to
        // each opponent and each planeswalker you don't control (opp Garruk seeded
        // as the extra damage sink). A 4th land this turn no-ops.
        label: "Omnath, Locus of Creation — three landfalls: life / mana / 4 damage",
        spec: {
            cards: [
                {
                    name: "Omnath, Locus of Creation",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Forest", owner: "me", zone: "hand", count: 3 },
                {
                    name: "Garruk Wildspeaker",
                    owner: "opp",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Leovold, Emissary of Trest (CR 614 draw-lock + CR 603.2b BECAME_TARGET
        // trigger). Golden path: Leovold on your battlefield; the opponent casts
        // Lightning Bolt (seeded in their hand, with Mountains) at Leovold — you may
        // draw a card. Static clause: that opponent can't draw a second card this
        // turn.
        label: "Leovold, Emissary of Trest — opponent targets Leovold → may draw + draw-lock",
        spec: {
            cards: [
                {
                    name: "Leovold, Emissary of Trest",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                {
                    name: "Mountain",
                    owner: "opp",
                    zone: "battlefield",
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Hullbreacher (CMR, issue #778) — draw-replacement on OPPONENT extra
        // draws. Golden path: Hullbreacher on my battlefield; on the opponent's
        // turn (or at instant speed) they cast Ancestral Recall to draw three.
        // None of those is the turn-based draw-step draw, so each is redirected
        // → I create three Treasure tokens instead of the opponent drawing.
        label: "Hullbreacher — opponent's extra draws become my Treasures",
        spec: {
            cards: [
                { name: "Hullbreacher", owner: "me", zone: "battlefield" },
                { name: "Ancestral Recall", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
            libraryCount: 6,
        },
    },
    {
        // Show and Tell (USG) — each player may cheat one artifact/creature/
        // enchantment/land from hand onto the battlefield. Golden path: cast
        // Show and Tell; both players are prompted, put a big creature from hand
        // straight into play (mine Craw Wurm, opp Air Elemental) with no mana.
        label: "Show and Tell — both players cheat a creature into play",
        spec: {
            cards: [
                { name: "Show and Tell", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
                { name: "Air Elemental", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Time Spiral (USG, issue #1308) — exile self, each player shuffles hand
        // + graveyard into library and draws seven, then you untap up to six
        // lands. Golden path: hand and graveyard seeded (wheel is visible), six
        // Islands to tap for the {4}{U}{U} cost, then untap up to six of them.
        // libraryCount funds the seven-card draws for both players.
        label: "Time Spiral — wheel hand+graveyard, redraw 7, untap 6 lands",
        spec: {
            cards: [
                { name: "Time Spiral", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
                { name: "Serra Angel", owner: "me", zone: "graveyard" },
                { name: "Air Elemental", owner: "me", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
            libraryCount: 10,
        },
    },
    {
        // Flash (MIR, issue #686) — put a creature from hand onto the
        // battlefield, then sacrifice it unless you pay its mana cost reduced by
        // {2}. Golden path: cast Flash, put Craw Wurm into play, then choose to
        // pay {4} (its {6} cost minus {2}) or let it be sacrificed.
        label: "Flash — cheat Craw Wurm in, pay reduced cost or sacrifice",
        spec: {
            cards: [
                { name: "Flash", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
        },
    },
    {
        // Zur's Weirding (ICE, issue #735) — all hands revealed; any draw is
        // revealed first and any OTHER player may pay 2 life to bin it. Golden
        // path: Zur's Weirding on my battlefield, cast Ancestral Recall to draw
        // three — each revealed card gives the opponent the option to pay 2 life
        // to send it to the graveyard instead of my drawing it.
        label: "Zur's Weirding — draw reveals, opponent may pay 2 life to bin",
        spec: {
            cards: [
                { name: "Zur's Weirding", owner: "me", zone: "battlefield" },
                { name: "Ancestral Recall", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
            libraryCount: 6,
        },
    },
    {
        // Winter's Chill (ICE) — cast during combat before blockers; X capped by
        // snow lands you control. Choose X attacking creatures; each controller
        // may pay {1} or {2} or lose the creature at end of combat. Golden path:
        // three Snow-Covered Islands (X up to 3), opponent's two Grizzly Bears
        // are attacking; cast at DECLARE_ATTACKERS choosing X=2 to hit both.
        label: "Winter's Chill — snow-capped X on attacking creatures",
        spec: {
            cards: [
                { name: "Winter's Chill", owner: "me", zone: "hand" },
                {
                    name: "Snow-Covered Island",
                    owner: "me",
                    zone: "battlefield",
                    count: 3,
                },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "DECLARE_ATTACKERS",
        },
    },
    {
        // Reviving Vapors (INV, issue #1101) — reveal top three, put one into
        // hand, gain life equal to its mana value, bin the other two. Golden
        // path: top three of my library are Craw Wurm (MV 6), Serra Angel (MV 5)
        // and Grizzly Bears (MV 2); cast Reviving Vapors, keep one, gain that
        // card's mana value in life, the other two go to the graveyard.
        label: "Reviving Vapors — dig 3, keep 1, gain life = its mana value",
        spec: {
            cards: [
                { name: "Reviving Vapors", owner: "me", zone: "hand" },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 0,
                },
                {
                    name: "Serra Angel",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "library",
                    position: 2,
                },
                { name: "Plains", owner: "me", zone: "battlefield", count: 2 },
                { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            ],
            phase: "PRECOMBAT_MAIN",
        },
    },
    {
        // Chromatic Sphere (INV) — "{1}, {T}, Sacrifice: Add one mana of any
        // color. Draw a card." Golden path: Chromatic Sphere untapped on my
        // battlefield; activate it, pick a color of mana, sacrifice it, and draw
        // a card (drawsCardOnTap). libraryCount gives it a card to draw.
        label: "Chromatic Sphere — sac for any-color mana and a card",
        spec: {
            cards: [
                {
                    name: "Chromatic Sphere",
                    owner: "me",
                    zone: "battlefield",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
            libraryCount: 4,
        },
    },
    {
        // Currency Converter (NCC) — "{2}, {T}: Draw a card, then discard a
        // card", and the discard triggers "you may exile that card from your
        // graveyard". Golden path: Converter untapped on my battlefield, spare
        // cards in hand to discard; activate draw-then-discard, then accept the
        // may-exile trigger to stash the discarded card for later retrieval.
        label: "Currency Converter — draw, discard, then exile the discard",
        spec: {
            cards: [
                {
                    name: "Currency Converter",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
            libraryCount: 4,
        },
    },
    {
        // Multiversal Passage (SPM) — "As this land enters, choose a basic land
        // type. Then you may pay 2 life. If you don't, it enters tapped. This
        // land is the chosen type." Golden path: play Multiversal Passage from
        // hand; on entry choose a basic land type, then choose to pay 2 life
        // (enters untapped) or decline (enters tapped) — it taps for the chosen
        // color thereafter.
        label: "Multiversal Passage — choose a basic type, pay 2 life or tapped",
        spec: {
            cards: [{ name: "Multiversal Passage", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
        },
    },
    {
        // Arc Lightning (CR 601.2d divide-as-you-choose). Cast the {X}{R}
        // sorcery with X=2 → 3 damage divided as you choose among one, two, or
        // three targets. Golden path: split across the three opposing Grizzly
        // Bears (e.g. 1/1/1) via the per-target stepper, or dump all 3 onto one
        // to kill a 2/2. Three targets seeded so the divide UI is exercised.
        label: "Arc Lightning — divide 3 damage among up to three creatures",
        spec: {
            cards: [
                { name: "Arc Lightning", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Arc Mage (NEM). {2}{R}, {T}, Discard a card: deal 2 damage divided as
        // you choose among one or two targets. Golden path: Arc Mage already in
        // play untapped (not summoning sick), a Mountain in hand to pay the
        // discard cost, tap + pay {2}{R}, then split 2 damage (1/1 or 2/0)
        // across the two opposing Grizzly Bears via the divide stepper.
        label: "Arc Mage — tap + discard, divide 2 damage among up to two creatures",
        spec: {
            cards: [
                { name: "Arc Mage", owner: "me", zone: "battlefield" },
                { name: "Mountain", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Sneak Attack (USG). {R}: put a creature from hand onto the battlefield;
        // it gains haste and is sacrificed at the next end step. Golden path:
        // enchantment already in play, activate for {R}, cheat the Craw Wurm
        // (6/4) in from hand with haste — attack this turn — then watch the
        // delayed trigger sacrifice it at the beginning of the end step.
        label: "Sneak Attack — cheat Craw Wurm in for {R}, haste now, sac at end step",
        spec: {
            cards: [
                { name: "Sneak Attack", owner: "me", zone: "battlefield" },
                { name: "Craw Wurm", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 1,
        },
    },
    {
        // Flametongue Kavu (PLS). {3}{R} 4/2 — "When this creature enters, it
        // deals 4 damage to target creature." Golden path: cast from hand, the
        // self-ETB trigger goes on the stack asking for a target, point it at an
        // opposing Grizzly Bears (2/2) to blow it up (4 damage, overkill). Two
        // opposing creatures seeded so the target choice is meaningful.
        label: "Flametongue Kavu — ETB deals 4 damage to a target creature",
        spec: {
            cards: [
                { name: "Flametongue Kavu", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Voldaren Epicure (VOW). {R} 1/1 — "When this creature enters, it deals
        // 1 damage to each opponent. Create a Blood token." Golden path: cast
        // for {R}; the self-ETB deals 1 to the opponent and puts a Blood token
        // (artifact: "{1}, {T}, Discard a card, Sacrifice this token: Draw a
        // card.") onto your battlefield.
        label: "Voldaren Epicure — ETB pings opponent for 1 and makes a Blood token",
        spec: {
            cards: [{ name: "Voldaren Epicure", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            landCount: 1,
        },
    },
    {
        // Bloodtithe Harvester (VOW). ETB makes a Blood token; then "{T},
        // Sacrifice this creature: Target creature gets -X/-X, X = twice the
        // Blood tokens you control. Activate only as a sorcery." Golden path:
        // Harvester already in play untapped (not sick); cast the Voldaren
        // Epicure ({R}) to generate a Blood token, then tap + sacrifice the
        // Harvester (X = 2×1 = 2) to give the opposing Grizzly Bears -2/-2,
        // killing the 2/2.
        label: "Bloodtithe Harvester — sac for -X/-X scaled by Blood tokens",
        spec: {
            cards: [
                {
                    name: "Bloodtithe Harvester",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Voldaren Epicure", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Harvester of Misery (BIG). {3}{B}{B} 5/4 Menace — "When this creature
        // enters, other creatures get -2/-2 until end of turn." Golden path:
        // cast from hand; the self-ETB sweeps every OTHER creature for -2/-2,
        // wiping the two opposing Grizzly Bears (2/2 → 0/0, SBA death) while the
        // Harvester itself is unaffected (the trailing self +2/+2 cancels the
        // sweep). Its alt mode "{1}{B}, Discard this card: target -2/-2" is also
        // castable straight from hand.
        label: "Harvester of Misery — ETB gives all OTHER creatures -2/-2",
        spec: {
            cards: [
                { name: "Harvester of Misery", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 5,
        },
    },
    {
        // Consuming Aetherborn (MOM). {3}{B} 2/2 Backup 1, Lifelink. Golden
        // path: cast from hand; the Backup 1 self-ETB puts a +1/+1 counter on
        // target creature — point it at your own Grizzly Bears (another
        // creature), so it becomes a 3/3 and gains lifelink until end of turn.
        // Targeting the Aetherborn itself instead just grows it (it keeps its
        // own lifelink).
        label: "Consuming Aetherborn — Backup 1 grants +1/+1 counter and lifelink",
        spec: {
            cards: [
                { name: "Consuming Aetherborn", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Barrowgoyf (M3C). {2}{B} */1+* Deathtouch, Lifelink — power = distinct
        // card types among cards in ALL graveyards, toughness that + 1. With a
        // Grizzly Bears (Creature) and a Swamp (Land) in the graveyard it is a
        // 2/3. Golden path: attack the open opponent; on combat damage "you may
        // mill that many cards, then put a creature card from among them into
        // your hand" — Craw Wurm seeded on top of the library so the milled
        // pile has a creature to retrieve.
        label: "Barrowgoyf — CDA P/T from graveyard types, mill-and-retrieve on combat damage",
        spec: {
            cards: [
                { name: "Barrowgoyf", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Swamp", owner: "me", zone: "graveyard" },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 0,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Starting Town (FIN). Land — "enters tapped unless it's your first,
        // second, or third turn of the game. {T}: Add {C}. {T}, Pay 1 life: Add
        // one mana of any color." Golden path: play it from hand on an early
        // turn (turn ≤ 3 → enters UNTAPPED via entersTappedUnless), then tap it
        // either for {C} (free) or for one mana of any color by paying 1 life —
        // two independent {T} mana abilities with different costs.
        label: "Starting Town — enters untapped turns 1-3, taps for {C} or any color for 1 life",
        spec: {
            cards: [{ name: "Starting Town", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Squirrel Nest (ody/green.ts) — Aura granting the enchanted LAND a
        // token-making tap ability (activated-grant StaticEffect, AURA_AFFECTS_HOST).
        // Golden path: the Aura is already on a Forest; tap that Forest and its
        // granted "{T}: Create a 1/1 green Squirrel" makes a Squirrel token.
        label: "Squirrel Nest — enchanted land taps for a 1/1 Squirrel",
        spec: {
            cards: [
                { name: "Forest", owner: "me", zone: "battlefield" },
                {
                    name: "Squirrel Nest",
                    owner: "me",
                    zone: "battlefield",
                    attachedTo: "Forest",
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Earthcraft (tmp/green.ts) — "Tap an untapped creature you control:
        // Untap target basic land." The activation cost is a tapOtherFilter pick
        // (tap the untapped Grizzly Bears), not the enchantment tapping itself.
        // Golden path: activate, tap the Bears, untap the tapped Forest.
        label: "Earthcraft — tap a creature to untap a basic land",
        spec: {
            cards: [
                { name: "Earthcraft", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                {
                    name: "Forest",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Satyr Wayfinder (bng/green.ts) — ETB digToHand: reveal top 4, you may
        // put a LAND into hand, rest to graveyard. Golden path: cast the Wayfinder
        // ({1}{G}); the top-4 window has Forests to keep and non-lands (Grizzly
        // Bears / Craw Wurm) that fall into the graveyard.
        label: "Satyr Wayfinder — ETB reveals top 4, keep a land, mill the rest",
        spec: {
            cards: [
                { name: "Satyr Wayfinder", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "library", position: 0 },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "library",
                    position: 1,
                },
                { name: "Forest", owner: "me", zone: "library", position: 2 },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 3,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Scythecat Cub (j25/green.ts) — Landfall: put a +1/+1 counter on target
        // creature you control; the SECOND resolution this turn DOUBLES the
        // counters instead (abilityResolutionCount gate). Golden path: play the
        // first Forest → +1/+1 on the Cub; play the second Forest → its counters
        // double (edge case). Grizzly Bears is an alternate counter target.
        label: "Scythecat Cub — Landfall counter, second land drop doubles",
        spec: {
            cards: [
                { name: "Scythecat Cub", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Tireless Tracker (soi/green.ts) — Landfall: investigate (create a Clue
        // token); whenever you sacrifice a Clue, put a +1/+1 counter on the
        // Tracker. Golden path: play a Forest → a Clue token appears; then pay
        // "{2}, Sacrifice this Clue: Draw a card" and the sac puts a +1/+1 on the
        // Tracker. Second Forest in hand to make a second Clue. landCount funds
        // the Clue's {2} sac cost.
        label: "Tireless Tracker — Landfall investigate, sac Clue for a counter",
        spec: {
            cards: [
                { name: "Tireless Tracker", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Sandstorm Salvager (big/green.ts) — ETB creates a 3/3 colorless Golem
        // token; "{2}, {T}: put a +1/+1 counter on each creature token you control,
        // they gain trample." Golden path: cast the Salvager ({2}{G}) → a Golem
        // token enters. (Edge/follow-up next turn: once un-sick, tap + pay {2} to
        // buff every token — Golem becomes 4/4 with trample.) landCount funds both.
        label: "Sandstorm Salvager — ETB makes a Golem token, then buff the tokens",
        spec: {
            cards: [{ name: "Sandstorm Salvager", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Badgermole Cub (tla/green.ts) — ETB "earthbend 1" (SET_KEYWORDS registry,
        // id "earthbend"): target land you control becomes a 0/0 Elemental creature
        // with haste (animate Op) then gets a +1/+1 counter — net a 1/1 hasty
        // creature-land. Golden path: cast the Cub ({1}{G}) and target one of your
        // Forests. (Its mana-doubler clause then adds an extra {G} per creature
        // tapped for mana.) landCount seeds the Forests to target.
        label: "Badgermole Cub — earthbend 1 animates your land into a 1/1",
        spec: {
            cards: [{ name: "Badgermole Cub", owner: "me", zone: "hand" }],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Worldspine Wurm (rtr/green.ts) — dies-trigger: create three 5/5 trample
        // Wurm tokens; and when put into a graveyard from anywhere, shuffle it into
        // its owner's library. Golden path: cast Terror ({1}{B}) on your own 15/15
        // Wurm → it dies, three 5/5 Wurm tokens appear, and the Wurm itself is
        // shuffled back into your library rather than staying in the graveyard.
        label: "Worldspine Wurm — dies into three 5/5 Wurms, shuffles itself back",
        spec: {
            cards: [
                { name: "Worldspine Wurm", owner: "me", zone: "battlefield" },
                { name: "Terror", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Icetill Explorer (eoe/green.ts) — extra land drop each turn + may play
        // lands FROM your graveyard + Landfall: mill a card. Golden path: play the
        // first Forest from hand (Landfall → mill 1), then use the extra land drop
        // to play the Forest sitting in your graveyard (Landfall → mill again).
        // libraryCount supplies cards to mill; landCount is board ramp.
        label: "Icetill Explorer — extra land drop, play land from graveyard, mill on landfall",
        spec: {
            cards: [
                { name: "Icetill Explorer", owner: "me", zone: "battlefield" },
                { name: "Forest", owner: "me", zone: "hand" },
                { name: "Forest", owner: "me", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
            libraryCount: 10,
        },
    },
    {
        // Iron-Shield Elf (ecl/black.ts) — "Discard a card: This creature gains
        // indestructible until end of turn. Tap it." The cost is a discardFilter
        // pick (choose a card to discard), not a mana/tap cost. Golden path:
        // activate, discard the spare Grizzly Bears from hand → the Elf gains
        // indestructible and taps itself as a resolved effect.
        label: "Iron-Shield Elf — discard a card for indestructible, taps itself",
        spec: {
            cards: [
                { name: "Iron-Shield Elf", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 2,
        },
    },
    {
        // Chromatic Armor (ICE, CR 615 colour-filtered damage-prevention shield
        // on the Aura's host). Golden path: cast the Aura on your Grizzly Bears,
        // choose a colour (pick Red) as it enters, then have the opponent aim
        // their Lightning Bolt at the enchanted creature — a red source, so all
        // its damage is prevented. The {X}: re-choose ability (X = sleight
        // counters) lets you retarget the shield to another colour later.
        label: "Chromatic Armor — choose a colour, prevent all damage from that colour's sources",
        spec: {
            cards: [
                { name: "Chromatic Armor", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
        },
    },
    {
        // Touch of Vitae (ICE, CR 702 haste grant + a granted {0} untap ability
        // + a next-upkeep cantrip delayedTrigger). Golden path: cast it on your
        // TAPPED Grizzly Bears — the target immediately gains haste and the
        // "{0}: Untap this creature. Activate only once." granted ability, so
        // you can untap it back for free, and you draw a card at the next
        // turn's upkeep.
        label: "Touch of Vitae — grant haste + a {0} untap ability, cantrip next upkeep",
        spec: {
            cards: [
                { name: "Touch of Vitae", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "battlefield",
                    tapped: true,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Enduring Renewal (ICE — draw-replacement + creature-death return).
        // Golden path: the enchantment is already in play. Have the opponent
        // Lightning Bolt your battlefield Grizzly Bears; as it's put into your
        // graveyard from the battlefield the triggered ability returns it to
        // your hand. The second Grizzly Bears sits on top of your library to
        // exercise the draw replacement (reveal a creature → graveyard → return
        // to hand) when you reach your draw step.
        label: "Enduring Renewal — creature death returns to hand; draw reveals a creature",
        spec: {
            cards: [
                {
                    name: "Enduring Renewal",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                {
                    name: "Grizzly Bears",
                    owner: "me",
                    zone: "library",
                    position: 0,
                },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Containment Priest (C14 — replacement: a nontoken creature that
        // enters and wasn't cast is exiled instead). Golden path: the Priest is
        // in play; cast Reanimate on the Grizzly Bears in your graveyard — it
        // would enter the battlefield without being cast, so the Priest's
        // replacement exiles it instead. (Priest also has flash; a second copy
        // sits in hand to feel the flash-in timing.)
        label: "Containment Priest — reanimated creature is exiled instead of entering",
        spec: {
            cards: [
                {
                    name: "Containment Priest",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Containment Priest", owner: "me", zone: "hand" },
                { name: "Grizzly Bears", owner: "me", zone: "graveyard" },
                { name: "Reanimate", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Lion Sash (NEO — {W} graveyard-exile that grows it, plus Reconfigure).
        // Golden path: activate "{W}: Exile target card from a graveyard" on the
        // Grizzly Bears in the opponent's graveyard — it's a permanent card, so
        // a +1/+1 counter goes on the Sash. Then Reconfigure {2} at sorcery
        // speed to attach the Sash to your own Grizzly Bears, which then gets
        // +1/+1 for each counter on the Sash.
        label: "Lion Sash — exile a permanent card for a counter, then Reconfigure onto a creature",
        spec: {
            cards: [
                { name: "Lion Sash", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                { name: "Grizzly Bears", owner: "opp", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Dark Confidant (FIN — upkeep reveal + life loss = mana value). Golden
        // path: at the beginning of your upkeep the trigger reveals the top card
        // of your library (Craw Wurm, mana value 6), puts it into your hand, and
        // you lose 6 life. Craw Wurm is pinned on top of the library so the life
        // swing is deterministic. Phase set to UPKEEP so the trigger is imminent.
        label: "Dark Confidant — upkeep reveals top card, lose life equal to its mana value",
        spec: {
            cards: [
                { name: "Dark Confidant", owner: "me", zone: "battlefield" },
                {
                    name: "Craw Wurm",
                    owner: "me",
                    zone: "library",
                    position: 0,
                },
            ],
            phase: "UPKEEP",
            landCount: 3,
        },
    },
    {
        // Coveted Jewel (C18 — ETB draw three; {T} for three mana; steal on an
        // unblocked opponent attack). Golden path: cast the {6} artifact from
        // hand and the enter trigger draws you three cards. The two opposing
        // Grizzly Bears are seeded so you can also drive the steal trigger:
        // attack you unblocked with them and that player draws three and gains
        // control of the Jewel, untapping it.
        label: "Coveted Jewel — enter draws three; unblocked attacker steals it",
        spec: {
            cards: [
                { name: "Coveted Jewel", owner: "me", zone: "hand" },
                {
                    name: "Grizzly Bears",
                    owner: "opp",
                    zone: "battlefield",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
        },
    },
    {
        // Vivi Ornitier (FIN — noncreature-cast trigger + power-scaled mana
        // ability). Golden path: Vivi is a 0/3 in play. Cast a Lightning Bolt
        // (a noncreature spell) — the trigger puts a +1/+1 counter on Vivi
        // (now 1/4) and deals 1 damage to the opponent. Her "{0}: Add X mana of
        // {U}/{R}, X = her power" ability then produces 1 mana; cast the second
        // Bolt to grow her further and feel X scale.
        label: "Vivi Ornitier — noncreature cast grows her + pings; mana ability scales with power",
        spec: {
            cards: [
                { name: "Vivi Ornitier", owner: "me", zone: "battlefield" },
                {
                    name: "Lightning Bolt",
                    owner: "me",
                    zone: "hand",
                    count: 2,
                },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Yawgmoth's Will (USG — grantGraveyardPlay permission Op + graveyard
        // exile redirect). Golden path: cast Yawgmoth's Will, then this turn
        // cast the Lightning Bolt and Dark Ritual sitting in your graveyard and
        // play the Swamp from there too — all enabled by the granted
        // play-from-graveyard permission. Cards leaving for the graveyard this
        // turn are exiled instead (armGraveyardRedirect).
        label: "Yawgmoth's Will — play lands and cast spells from your graveyard this turn",
        spec: {
            cards: [
                { name: "Yawgmoth's Will", owner: "me", zone: "hand" },
                { name: "Lightning Bolt", owner: "me", zone: "graveyard" },
                { name: "Dark Ritual", owner: "me", zone: "graveyard" },
                { name: "Swamp", owner: "me", zone: "graveyard" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 4,
        },
    },
    {
        // Companion framework — Lurrus of the Dream-Den (issue #1392, ADR
        // 0064). ONE Lurrus already on the battlefield exercises its STATIC,
        // once-per-turn graveyard-permanent-cast permission immediately
        // (`castsPermanentsFromGraveyard`): Savannah Lions (MV 1) sits in the
        // graveyard, castable for its normal {W} cost via the "Cast" button.
        // A SECOND Lurrus sits in the (non-battlefield) companion slot,
        // unused, so the {3} "Companion" summon special action is also
        // one-click reachable — summoning it to hand doesn't itself trigger
        // the legend rule (only casting a second copy onto the battlefield
        // would). Golden path: click Savannah Lions' graveyard "Cast" button
        // (pays {W}) OR click "Companion {3}" to summon the slot's Lurrus.
        label: "Lurrus — battlefield graveyard-permanent-cast permission + companion summon",
        spec: {
            cards: [
                {
                    name: "Lurrus of the Dream-Den",
                    owner: "me",
                    zone: "battlefield",
                },
                { name: "Savannah Lions", owner: "me", zone: "graveyard" },
            ],
            companion: {
                name: "Lurrus of the Dream-Den",
                owner: "me",
                used: false,
            },
            phase: "PRECOMBAT_MAIN",
            landCount: 6,
        },
    },
    {
        // Urza's Bauble (issue #674, CR 701.18a look). {T}, Sacrifice: privately
        // look at a card at random in the target player's hand, then arm a
        // next-upkeep cantrip (CR 603.7d). Golden path: activate the Bauble
        // targeting the opponent — the activator alone sees a "look" dialog
        // revealing one random card from the opponent's hand (the private
        // `lookRandomHand` Op), and a delayed draw is scheduled for your next
        // upkeep. The opponent is seeded three distinct hand cards so the
        // random pick is observable.
        label: "Urza's Bauble — private look at a random card in the opponent's hand + next-upkeep draw",
        spec: {
            cards: [
                { name: "Urza's Bauble", owner: "me", zone: "battlefield" },
                { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                { name: "Grizzly Bears", owner: "opp", zone: "hand" },
                { name: "Dark Ritual", owner: "opp", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 3,
        },
    },
    {
        // Goblin Artisans (atq/red.ts) — the synchronous `coinFlipSync` Op
        // (issue #1281): "{T}: Flip a coin. If you win the flip, draw a card.
        // If you lose the flip, counter target artifact spell you control."
        // No CR 705.2/ADR 0023 reveal-ack suspension — the whole ability
        // (flip + branch) resolves in one pass, unlike the suspending
        // `coinFlip` Op. Golden path: cast the free Ornithopter (a {0}
        // artifact spell) so it lands on the stack, then activate Goblin
        // Artisans targeting it — a WIN draws a card (Ornithopter still
        // resolves); a LOSS counters the Ornithopter instead of drawing.
        label: "Goblin Artisans — synchronous coin flip: draw a card, or counter your own artifact spell",
        spec: {
            cards: [
                { name: "Goblin Artisans", owner: "me", zone: "battlefield" },
                { name: "Ornithopter", owner: "me", zone: "hand" },
            ],
            phase: "PRECOMBAT_MAIN",
            landCount: 1,
        },
    },
];

/**
 * Seed the `NEW_MECHANIC_SCENARIOS` as ownerless golden `debugScenarios` rows.
 * Idempotent by label — mirrors `seedPresetScenarios`. Re-run after every deploy
 * that appends new scenarios; the label skip makes it safe to re-run any time.
 * Scenarios are shared across all admins, so no `userId` arg is needed.
 * `internalMutation`: reachable only via the Convex dashboard / `npx convex run`
 * with deploy access, never from a client.
 * `npx convex run debugScenarios:seedNewMechanicScenarios`
 */
export const seedNewMechanicScenarios = internalMutation({
    args: {},
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx) => {
        // Dedup against the WHOLE shared pool by label — golden seeds are
        // ownerless (any admin sees them), so idempotency is pool-wide, not
        // per-user. Bounded scan: the table is kept small by
        // `cleanupEphemeralScenarios`.
        const existing = await ctx.db.query("debugScenarios").take(1000);
        const existingLabels = new Set(existing.map((row) => row.label));

        // Tombstoned labels (issue #1422): a hard-deleted scenario's label must
        // NOT resurrect on the next seed even though it's no longer among
        // `existingLabels` — `deleteDebugScenario` records it here. Bounded scan,
        // same style as the `debugScenarios` query above.
        const tombstones = await ctx.db
            .query("debugScenarioTombstones")
            .take(1000);
        const tombstonedLabels = new Set(tombstones.map((row) => row.label));

        const { toInsert, skipped } = selectPresetsToSeed(
            NEW_MECHANIC_SCENARIOS,
            existingLabels,
            tombstonedLabels
        );

        // Same loadability guard as the write path — reject before insert if any
        // referenced card name doesn't resolve in the catalogue (ADR 0044).
        let inserted = 0;
        for (const preset of toInsert) {
            const unresolved = collectUnresolvedCardNames(
                preset.spec,
                (name) => tryGetCardByName(name) !== null
            );
            if (unresolved.length > 0) {
                throw new Error(
                    `Scenario "${preset.label}" references unknown card(s): ${unresolved.join(", ")}`
                );
            }
            await ctx.db.insert("debugScenarios", {
                label: preset.label,
                spec: preset.spec,
                golden: true,
                schemaVersion: SCENARIO_SCHEMA_VERSION,
                createdAt: Date.now(),
            });
            inserted++;
        }
        return { inserted, skipped };
    },
});

// Exported for tests only — same loadability proof as the migration list.
export { NEW_MECHANIC_SCENARIOS };
