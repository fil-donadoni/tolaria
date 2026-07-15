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

// ---- New-mechanic scenarios (Cube / Storm / DSL batch, 2026-07-14 → 15) ------

/**
 * Golden manual-test scenarios for the cards & mechanics shipped in the
 * 2026-07-14/15 batch that the frozen `MIGRATED_PRESET_SCENARIOS` list does not
 * cover (Storm, Brainstorm put-back Op, Recoil owner-discard, negative-X, mana
 * from effective power, Evoke, self-shuffle/mv-ceiling search, discard-cost
 * search, discard-leg mayPay, Cube-FREE utility). Authored straight into the DB
 * per ADR 0044 — a scenario added after the #770 migration is a `debugScenarios`
 * row, never appended to the frozen list above. Seed with:
 * `npx convex run debugScenarios:seedNewCubeScenarios '{"userId":"<id>"}'`
 */
const NEW_CUBE_SCENARIOS: { label: string; spec: ScenarioSpec }[] = [
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
];

/**
 * Seed the `NEW_CUBE_SCENARIOS` as golden `debugScenarios` rows owned by
 * `userId` (issue-batch 2026-07-14/15). Idempotent by label — mirrors
 * `seedPresetScenarios`. `internalMutation`: reachable only via the Convex
 * dashboard / `npx convex run` with deploy access, never from a client.
 * `npx convex run debugScenarios:seedNewCubeScenarios '{"userId":"<id>"}'`
 */
export const seedNewCubeScenarios = internalMutation({
    args: { userId: v.id("users") },
    returns: v.object({ inserted: v.number(), skipped: v.number() }),
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("debugScenarios")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .collect();
        const existingLabels = new Set(existing.map((row) => row.label));

        // Same loadability guard as the write path — reject before insert if any
        // referenced card name doesn't resolve in the catalogue (ADR 0044).
        let inserted = 0;
        let skipped = 0;
        for (const preset of NEW_CUBE_SCENARIOS) {
            if (existingLabels.has(preset.label)) {
                skipped++;
                continue;
            }
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
                userId: args.userId,
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
export { NEW_CUBE_SCENARIOS };
