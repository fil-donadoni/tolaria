// PLS (Planeshift) — green cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Mirrorwood Treefolk — {3}{G} Creature — Treefolk, 2/4. "{2}{R}{W}: The next
// time damage would be dealt to this creature this turn, that damage is
// dealt to any target instead." (CR 614 one-shot transient redirection,
// issue #1939.)
//
// Targeting fix (PR #1978 review): "any target" is chosen when the ability
// is PUT ON THE STACK (CR 601.2c / 602.2b), not mid-resolution — issue
// #1939's "chosen as the ability resolves" wording conflicted with the CR
// (commented on the issue). The ability declares
// `targetRequirement: { type: "any", count: 1 }`, exactly like Cuombajj
// Witches' controller-chosen ping (`convex/cards/sets/arn/black.ts`), which
// routes the pick through `getLegalTargets`/`selectTarget` — the real CR
// 115.4/608.2b/protection/hexproof/shroud gate — instead of an unfiltered
// candidate list assembled at resolution. `choose-damage-target` stays
// reserved for a genuinely mid-resolution, OPPONENT-chosen pick (Cuombajj's
// second ping); this one is the controller's own announced target, so it
// needs no request/disambiguation step at all.
//
// protocol card: `resolve()` still installs a transient
// `addDamageRedirectionShield` shield, a `resolve()`-only SpellContext
// primitive with no Effect Script Op wrapper (like Jade Monolith,
// `convex/cards/sets/lea/colorless.ts`). Not migratable to `effects[]`.
//
// Generalizes the redirection list's `from-source-to-permanent-redirect`
// shield (`gre/state.ts`, previously Jade Monolith-only with a
// player-only destination) so `redirectTo` can be a permanent too —
// `ctx.targets[0]` is already shaped as `{type:"player"|"permanent", id}`
// (`TargetSelection`), the exact same union `redirectTo` declares, so no
// disambiguation step is needed. No `sourceInstanceId` filter — the oracle
// text has no source restriction ("the next time damage would be dealt to
// this creature", from ANY source), unlike Jade Monolith's chosen-source
// filter.
//
// DIVERGENCE: the official ruling says "during combat it is possible for
// multiple sources to damage the Treefolk at one time, in which case damage
// from all of those sources is redirected" — but the shield is `remaining: 1`
// and the engine emits one combat-damage event PER SOURCE
// (`applyOneCombatDamage`, `convex/gre/phases.ts`), each independently
// running the CR 614 replacement loop, so only the first simultaneous
// source's damage is redirected; the rest lands on the Treefolk. Not fixed
// in this pass — tracked-by: #1983.
export const mirrorwoodTreefolk: CardDefinition = {
    id: "ba9a1c94-2b7f-4df7-8517-a122616d9ae4", // PLS printing (scryfallId)
    name: "Mirrorwood Treefolk",
    rarity: "uncommon",
    oracleText:
        "{2}{R}{W}: The next time damage would be dealt to this creature this turn, that damage is dealt to any target instead.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 2,
    toughness: 4,
    // AI valuation override (ADR 0018 / issue #1431, #1519's ability-level
    // extension): the redirect ability is `resolve()`-only with no `effects[]`
    // it could carry (see the protocol-card justification above) and its
    // `addDamageRedirectionShield` mechanism has no `EffectOp` a shadow script
    // could honestly approximate, so this plugs the `aiEffectsGuard`
    // ability-level gap (`convex/cards/__tests__/aiEffectsGuard.bot.test.ts`)
    // with a card-level override rather than a misleading shadow script.
    // Calibrated against `creatureValueRaw`/`LATENT_DISCOUNT`
    // (`gre/creatureBody.ts` / `gre/cardValue.ts`): a vanilla 2/4 for MV4
    // latents at ~175 (`(100 + 2*15 + 4*14 + 4*5) * 0.85`); +25 for the
    // repeatable defensive redirect (a fraction of `PREVENT_DAMAGE_FLAT_VALUE`
    // = 70, `gre/ai/opValuers.ts`, since it costs 4 mana and a stack action
    // per use rather than being a free static shield). Latent worth only —
    // the realized battlefield eval is unaffected (`cardValue.ts` doc).
    aiValue: 200,
    activatedAbilities: [
        {
            id: "mirrorwood-treefolk-redirect",
            oracleText:
                "{2}{R}{W}: The next time damage would be dealt to this creature this turn, that damage is dealt to any target instead.",
            cost: { mana: { X: 2, R: 1, W: 1 } },
            useStack: true,
            // Controller's target (CR 602.2b — chosen at activation), same
            // shape as Cuombajj Witches' controller-chosen ping.
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx) => {
                const target = ctx.targets[0];
                // "any target" (CR 115.4) only ever resolves to a permanent
                // or a player here — narrow defensively rather than widen
                // `DamageRedirection.redirectTo`'s union.
                if (
                    !target ||
                    (target.type !== "player" && target.type !== "permanent")
                ) {
                    return;
                }
                ctx.addDamageRedirectionShield({
                    kind: "from-source-to-permanent-redirect",
                    targetInstanceId: ctx.sourceInstanceId,
                    redirectTo: { type: target.type, id: target.id },
                    remaining: 1,
                    duration: { phase: "end-of-turn" },
                });
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Board-derived restricted-colour mana abilities (CR 605.1a, issue #1941).
// Quirion Explorer's colour set is not fixed and not "any colour": it is
// derived from a described slice of the board and recomputed at every
// activation. It is expressed as an `ActivatedAbility.manaColorSource`
// descriptor (`convex/cards/types.ts`) — declarative data, evaluated by the
// engine's single `boardDerivedManaChoices` authority (`gre/constants.ts`)
// that the castability probe, the auto-tap solver, the bot's payment planner
// and the client picker all already read. Same descriptor family as Fellwar
// Stone (`drk/colorless.ts`) and PLS's own Star Compass / Meteor Crater
// (`pls/colorless.ts`).
// ─────────────────────────────────────────────────────────────────────────────

// Quirion Explorer — {1}{G} Creature — Elf Druid Scout, 1/1. "{T}: Add one
// mana of any color that a land an opponent controls could produce."
// (CR 605.1a mana ability — `useStack: false`, resolves immediately, never
// uses the stack. CR 106.4 "could produce" over the OPPONENT's lands, so the
// offered colours come from THEIR mana base, not this creature's controller's.)
export const quirionExplorer: CardDefinition = {
    id: "141a031d-f899-497b-adf7-4af142078085",
    rarity: "common",
    name: "Quirion Explorer",
    oracleText:
        "{T}: Add one mana of any color that a land an opponent controls could produce.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid", "Scout"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "quirion-explorer-mana",
            oracleText:
                "{T}: Add one mana of any color that a land an opponent controls could produce.",
            cost: { tap: true },
            useStack: false,
            // Representative / fallback list for best-effort callers with no
            // board snapshot; the descriptor below overrides it wherever a
            // board is available (same contract as Fellwar Stone's).
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            // CR 106.4 / 109.5 — every colour any LAND an OPPONENT controls
            // could produce; empty (no colour offered, no false affordance)
            // while no opponent controls a colour-producing land.
            manaColorSource: {
                filter: { types: "Land", controllerRelation: "opponents" },
                colors: "produces",
            },
        },
    ],
};

// Amphibious Kavu — {2}{G} Creature — Kavu, 2/2. "Whenever this creature
// blocks or becomes blocked by one or more blue and/or black creatures, this
// creature gets +3/+3 until end of turn." (CR 509.1h "blocks or becomes
// blocked by" combat-pairing trigger; a Gatherer ruling confirms "The ability
// only triggers once per combat" — CR 603.3b "one or more" batching.)
//
// ONE `TriggeredAbility` on the single `BLOCKERS_CONFIRMED` event (CR 509.1,
// emitted once per attacker-blocker pair), `matches` discriminating which
// side of the pair `self` is on — the Chub Toad / Phyrexian Reaper shape, NOT
// the array-`event` multi-engine-event convention (that's for one Oracle
// sentence spanning genuinely distinct event TYPES, e.g. Worldspine Wurm's
// "put into a graveyard from anywhere").
//
// Colour filter reads the EFFECTIVE colour (CR 202.2, layer 5 —
// `colorOverride` / granted colours), carried directly on the event as
// `attackerColors`/`blockerColors` (`gre/phases.ts`'s `emitBlockersConfirmedEvents`,
// mirroring the pre-existing `attackerToughness`/`blockerToughness` fields)
// rather than read off `TriggerStateView.players[].battlefield[].colors` —
// the production `collectTriggers` call passes the raw live `GameState` as
// that state view, whose `CardInstanceState` carries no live `colors` field,
// so a `matches` reading `state.players[].battlefield[].colors` (Phyrexian
// Reaper/Slayer's existing pattern, inv/black.ts) never actually resolves a
// colour outside their own hand-built test fixtures — a pre-existing dead
// trigger in production, tracked-by: #1996 rather than silently fixed here
// (out of this slice's scope). Amphibious Kavu avoids that trap by reading
// the colour straight off the firing event instead.
//
// "One or more" batching (CR 603.3b): `oncePerEventBatch: true` collapses
// every BLOCKERS_CONFIRMED pair this permanent participates in during the
// SAME confirmation batch into a single trigger — a multi-blocked attacker
// pumps once even when several of its blockers are blue/black (Moonshadow,
// ecl/black.ts, is the precedent consumer).
//
// Effect body is the already-shipped `pump` Op (self, +3/+3, until end of
// turn) — no new primitive, no `resolve()`.
export const amphibiousKavu: CardDefinition = {
    id: "37d94fb2-958c-487e-9f64-52d2771c6ea4", // PLS 78
    rarity: "common",
    name: "Amphibious Kavu",
    oracleText:
        "Whenever this creature blocks or becomes blocked by one or more blue and/or black creatures, this creature gets +3/+3 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "amphibious-kavu-combat-pump",
            oracleText:
                "Whenever this creature blocks or becomes blocked by one or more blue and/or black creatures, this creature gets +3/+3 until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                const isBlockedAttacker = event.attackerId === self.id;
                const isBlocker = event.blockerId === self.id;
                if (!isBlockedAttacker && !isBlocker) return false;
                const otherColors = isBlockedAttacker
                    ? event.blockerColors
                    : event.attackerColors;
                return (
                    otherColors?.includes("U") === true ||
                    otherColors?.includes("B") === true
                );
            },
            oncePerEventBatch: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 3,
                    toughness: 3,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};
