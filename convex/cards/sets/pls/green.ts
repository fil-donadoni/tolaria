// PLS (Planeshift) — green cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type {
    ActivatedAbilityContext,
    CardDefinition,
    EffectTokenSpec,
    PermanentView,
    StaticEffectStateView,
} from "../../types";
import {
    AURA_AFFECTS_HOST,
    BASIC_LAND_SUBTYPES,
    EFFECT_AFFECTS_SELF,
    LANDWALK_KEYWORD_BY_BASIC_TYPE,
} from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { kickerPaidCondition } from "../../abilities/triggers/shared";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { colorChoiceModes } from "../../abilities/chooseColor";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

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
// DIVERGENCE: the official ruling says "during combat it is possible for (tracked-by: #2785)
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
    // could honestly approximate, so this plugs the `aiEffectsGuard` (tracked-by: #2785)
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

// ─────────────────────────────────────────────────────────────────────────────
// Free tranche (issue #1952) — the remaining 15-card slice manifest. Modern
// Scryfall Oracle text is authoritative (ADR 0004); mana costs / types /
// rarities verified against the PLS printing. Every effect is DSL-first
// (ADR 0045) unless noted.
// ─────────────────────────────────────────────────────────────────────────────

// Alpha Kavu — {2}{G} Creature — Kavu, 2/2. "{1}{G}: Target Kavu creature
// gets -1/+1 until end of turn." (CR 602.1 activated ability, `pump` Op with
// a negative power delta — the shrink half of the already-censused Giant
// Growth shape — restricted to the Kavu subtype via `TargetRequirement.
// subtypeFilter`, no new construct.)
export const alphaKavu: CardDefinition = {
    id: "545ed916-59fc-4c60-9260-8c2dc88e67a1", // PLS 77
    name: "Alpha Kavu",
    rarity: "uncommon",
    oracleText: "{1}{G}: Target Kavu creature gets -1/+1 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "alpha-kavu-pump",
            oracleText:
                "{1}{G}: Target Kavu creature gets -1/+1 until end of turn.",
            cost: { mana: { X: 1, G: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Kavu",
            },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Gaea's Herald — {1}{G} Creature — Elf, 1/1. "Creature spells can't be
// countered."
//
// STOP-AND-ISSUE (`.claude/rules/gre-development.md` § DSL-first authoring):
// the engine's only "can't be countered" mechanism is the per-spell,
// SELF-only `CardDefinition.cantBeCountered` flag (Obliterate, Blurred
// Mongoose, Kavu Chameleon) plus the per-cast `StackItem.
// dynamicCantBeCountered` rider (Delighted Halfling, issue #1559) — both
// checked by `SpellContext.counter()`'s single choke point
// (`convex/gre/state.ts`). Gaea's Herald needs a THIRD, board-state shape: a
// battlefield PERMANENT grants "can't be countered" to every CREATURE spell
// any player casts, for as long as it remains in play. Nothing at the
// counter() choke point reads board state today, and no static-effect kind
// flags an arbitrary spell (matched by a filter) as uncounterable from a
// permanent's continuous ability — a genuine new engine capability, not
// composable from existing Ops. Left as a commented stub rather than a
// card-shaped `resolve()` ("the Op I need doesn't exist yet" is explicitly
// not a valid `resolve()` justification). tracked-by: #2037
// export const gaeasHerald: CardDefinition = {
//     id: "aa52bc97-109a-4de5-b287-bce21dad6a9c", // PLS 80
//     name: "Gaea's Herald",
//     rarity: "rare",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Elf"],
// };

// Gaea's Might — {G} Instant. "Domain — Target creature gets +1/+1 until
// end of turn for each basic land type among lands you control." (CR 702
// preamble Domain ability word, issue #1066 — the `{ domain: { of } }`
// EffectValue grammar member composed directly into `pump`'s power/
// toughness, the exact Power Armor precedent the Domain registry row
// documents. No new construct.)
export const gaeasMight: CardDefinition = {
    id: "67e5adce-7735-4fa5-aa14-8dce012e9fcc", // PLS 81
    name: "Gaea's Might",
    rarity: "common",
    oracleText:
        "Domain — Target creature gets +1/+1 until end of turn for each basic land type among lands you control.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        {
            op: "pump",
            target: { target: 0 },
            power: { domain: { of: "controller" } },
            toughness: { domain: { of: "controller" } },
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Does `controllerId` control a land with the basic land subtype `landType`
// (CR 305.6)? The per-TYPE sibling of `countDomain`'s aggregate scan (same
// module, same board-read convention — raw `PermanentView.subtypes`, no
// text-change awareness, since no shipped card needs one here).
function controllerControlsBasicLandType(
    state: StaticEffectStateView,
    controllerId: string,
    landType: string
): boolean {
    return state.players.some((player) =>
        player.battlefield.some(
            (permanent) =>
                permanent.controllerId === controllerId &&
                permanent.types.includes("Land") &&
                permanent.subtypes.includes(landType)
        )
    );
}

// Magnigoth Treefolk — {4}{G} Creature — Treefolk, 2/6. "Domain — For each
// basic land type among lands you control, this creature has landwalk of
// that type." (CR 702 preamble Domain + CR 702.14 landwalk — Domain granting
// a SET of abilities, not a number. `StaticKeywordGrant.keyword` is a FIXED
// string, so a dynamic set is FIVE `keyword-grant` statics — one per basic
// land type — each gated by its own `condition` reading board state, exactly
// Traveler's Cloak's five-entry fan-out (`inv/blue.ts`) with a board-derived
// `condition` in place of Traveler's Cloak's stored chosen-type flag. No new
// construct: `keyword-grant`'s `condition` (CR 611.2c "as long as") already
// re-evaluates every stable transition via `refreshCounterGatedStatics`, so
// gaining/losing a basic land type mid-game keeps the granted set current.
// The subtype → keyword lookup is the shared `LANDWALK_KEYWORD_BY_BASIC_TYPE`
// (`cards/types.ts` — a dependency-free leaf, unlike `gre/constants.ts`,
// which imports the card registry and can't be imported FROM a `cards/sets/**`
// file without reopening the set↔registry eval-time cycle) — Traveler's
// Cloak's own `LANDWALK_BY_TYPE` table used to be a second, hand-authored
// copy of the same map; both now import the one export.)
export const magnigothTreefolk: CardDefinition = {
    id: "90c2869b-43cf-4d5e-8a54-9ae200f5bff9", // PLS 82
    name: "Magnigoth Treefolk",
    rarity: "rare",
    oracleText:
        "Domain — For each basic land type among lands you control, this creature has landwalk of that type.",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Treefolk"],
    power: 2,
    toughness: 6,
    staticEffects: BASIC_LAND_SUBTYPES.map((landType) => ({
        kind: "keyword-grant" as const,
        applies: EFFECT_AFFECTS_SELF,
        condition: (source: PermanentView, state: StaticEffectStateView) =>
            controllerControlsBasicLandType(
                state,
                source.controllerId,
                landType
            ),
        keyword: LANDWALK_KEYWORD_BY_BASIC_TYPE[landType],
    })),
};

// Multani's Harmony — {G} Enchantment — Aura. "Enchant creature. Enchanted
// creature has '{T}: Add one mana of any color.'" (CR 303.4 aura; CR 611.2c
// layer-6 ACTIVATED-ability grant — Squirrel Nest's `activated-grant` +
// `grantTemplates` shape (`ody/green.ts`), here with a `useStack: false`
// MANA ability template (CR 605.3a) instead of Squirrel Nest's stack-using
// token maker — the exact Urza's Saga chapter-I mana-ability shape
// (`mh2/colorless.ts`) granted to a HOST via `AURA_AFFECTS_HOST` rather than
// self-granted. Composition of two already-shipped, already-tested halves
// (issue #1880 confirmed `getEffectiveActivatedAbilities` — the single
// authority `getManaTapOptionsDetailed`/`hasManaAbility` read — already
// folds in `grantedActivatedAbilities` for a granted MANA ability, so the
// auto-tap solver and castability probe see this ability with no further
// engine work). "Any color" is the Black Lotus/Treasure `manaChoices`
// five-way picker (`sharedTokens.ts`'s `TREASURE_TOKEN`).
export const multanisHarmony: CardDefinition = {
    id: "c76352ea-e3d2-4221-8ebe-e953301c35ab", // PLS 84
    name: "Multani's Harmony",
    rarity: "uncommon",
    oracleText:
        'Enchant creature\nEnchanted creature has "{T}: Add one mana of any color."',
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "multanis-harmony-mana",
        },
    ],
    grantTemplates: [
        {
            id: "multanis-harmony-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

// Shared 1/1 green Saproling token (CR 111/707.2) for Nemata, Grove
// Guardian. Art reverse-linked from Nemata's own PLS printing via Scryfall
// `all_parts` (`scripts/fetch-token-prints.mjs`, `token-prints.json`) —
// not promoted to `sharedTokens.ts` since no other PLS card in this slice
// creates one (FEM's own Saproling stays local to `fem/green.ts` for the
// same reason; a later cross-set promotion is a separate, non-blocking
// cleanup).
// `EffectTokenSpec` (not `TokenSpec`): only ever used at a DSL `createToken`
// Op site (`op.token`) below, never through `ctx.createToken` directly.
const NEMATA_SAPROLING_TOKEN: EffectTokenSpec = {
    name: "Saproling",
    types: ["Creature"],
    subtypes: ["Saproling"],
    power: 1,
    toughness: 1,
    colors: ["G"],
    imagePrintId: tokenPrintIdFor(
        "8c6a0ca4-5006-4c9b-91cd-e01d77e4fdc2",
        "Saproling"
    ),
};

// Nemata, Grove Guardian — {4}{G}{G} Legendary Creature — Treefolk, 4/5.
// "{2}{G}: Create a 1/1 green Saproling creature token.\nSacrifice a
// Saproling: Saproling creatures get +1/+1 until end of turn." (CR 602.1
// activated abilities. First ability: the censused `createToken` Op with the
// shared Saproling spec above. Second ability: `cost.sacrificeFilter`
// (CR 602.1/118.5, "sacrifice a permanent matching <filter>", the
// Priest-of-Yawgmoth cost shape) restricted to the Saproling subtype, then a
// `forEach { set: "permanents", filter: { subtype: "Saproling" } }` mass
// `pump` — the Sengir Vampire-family anthem-until-end-of-turn shape (`big/
// green.ts`'s own forEach+pump sweep) — over EVERY Saproling on the
// battlefield REGARDLESS OF CONTROLLER (the `forEach` carries no
// `controller` field, so `selectForEachMembers` scans every player's
// battlefield — `interpreter.ts`), matching Nemata's Oracle text exactly:
// "Saproling creatures get +1/+1 until end of turn" names no controller, so
// an opponent's Saproling is pumped too, same as this ability's own
// controller's. Also includes a Saproling created by an activation of this
// same ability, since the sweep re-scans the battlefield at resolution.)
export const nemataGroveGuardian: CardDefinition = {
    id: "8c6a0ca4-5006-4c9b-91cd-e01d77e4fdc2", // PLS 85
    name: "Nemata, Grove Guardian",
    rarity: "rare",
    oracleText:
        "{2}{G}: Create a 1/1 green Saproling creature token.\nSacrifice a Saproling: Saproling creatures get +1/+1 until end of turn.",
    manaCost: { X: 4, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Treefolk"],
    power: 4,
    toughness: 5,
    activatedAbilities: [
        {
            id: "nemata-make-saproling",
            oracleText: "{2}{G}: Create a 1/1 green Saproling creature token.",
            cost: { mana: { X: 2, G: 1 } },
            useStack: true,
            effects: [
                {
                    op: "createToken",
                    token: NEMATA_SAPROLING_TOKEN,
                    controller: "controller",
                    count: 1,
                },
            ],
        },
        {
            id: "nemata-pump-saprolings",
            oracleText:
                "Sacrifice a Saproling: Saproling creatures get +1/+1 until end of turn.",
            cost: { sacrificeFilter: { subtypes: "Saproling" } },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { subtype: "Saproling" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 1,
                            toughness: 1,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Planeswalker's Favor — {2}{G} Enchantment. "{3}{G}: Target opponent
// reveals a card at random from their hand. Target creature gets +X/+X
// until end of turn, where X is the revealed card's mana value."
//
// STOP-AND-ISSUE (`.claude/rules/gre-development.md` § DSL-first authoring):
// the engine has the underlying primitive (`SpellContext.
// revealRandomHandCard`, CR 701.20a public reveal) but no Effect Script Op
// wraps it — the DSL's only random-hand-card Op, `lookRandomHand`, is the
// deliberately PRIVATE CR 400.2 sibling and has no `bind` to read the
// picked card's mana value back afterward regardless. Same gap as
// Planeswalker's Scorn (`pls/black.ts`, the cycle's black member, issue
// #1950) — tracked by the SAME shared issue, which explicitly lists this
// slice (#1952) among its siblings. Left as a stub rather than a
// card-shaped `resolve()`. tracked-by: #2004
// export const planeswalkersFavor: CardDefinition = {
//     id: "b3387540-93bf-451e-8e7a-fc78caab42b0", // PLS 86
//     name: "Planeswalker's Favor",
//     rarity: "rare",
//     manaCost: { X: 2, G: 1 },
//     types: ["Enchantment"],
// };

// Primal Growth — {2}{G} Sorcery. "Kicker—Sacrifice a creature. Search your
// library for a basic land card, put that card onto the battlefield, then
// shuffle. If this spell was kicked, instead search your library for up to
// two basic land cards, put them onto the battlefield, then shuffle."
// (CR 702.33a Kicker with a PERMANENT leg — `kickers[0].permanent`
// (ADR 0079); the count-branching search is a plain `if { kickerCount: true
// } >= 1` (already-censused predicate, `pls/black.ts`'s Bog Down/Falling
// Timber precedent) wrapping two `search-library` + `moveZone` + shuffle
// legs — the Frenzied Tilling / Elvish Guidance search-put-shuffle idiom
// (`inv/*.ts`), just with a `count: { min: 0, max: 2 }` on the kicked leg
// instead of `max: 1`.)
export const primalGrowth: CardDefinition = {
    id: "1d4a3c83-faaa-4dd9-9349-abcaf09cc7a8", // PLS 87
    name: "Primal Growth",
    rarity: "common",
    oracleText:
        "Kicker—Sacrifice a creature. (You may sacrifice a creature in addition to any other costs as you cast this spell.)\nSearch your library for a basic land card, put that card onto the battlefield, then shuffle. If this spell was kicked, instead search your library for up to two basic land cards, put them onto the battlefield, then shuffle.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Sacrifice a creature",
            permanent: {
                action: "sacrifice",
                filter: { types: "Creature" },
                count: 1,
            },
        },
    ],
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Land", supertype: "Basic" },
                    count: { min: 0, max: 2 },
                    prompt: "Search your library for up to two basic land cards.",
                    bind: "$lands",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$lands" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
            else: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Land", supertype: "Basic" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for a basic land card.",
                    bind: "$land",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$land" },
                    player: "controller",
                    from: "library",
                    to: "battlefield",
                },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};

// Pygmy Kavu — {3}{G} Creature — Kavu, 1/2. "When this creature enters,
// draw a card for each black creature your opponents control." (CR 603.6a
// self-ETB trigger; the count-of-filtered-permanents `draw` shape
// (`chk/blue.ts`'s Shrine-count precedent) — `count: { count: { zone:
// "battlefield", controller: "opponent", filter: { type: "Creature", color:
// "B" } } }` — no new construct.)
export const pygmyKavu: CardDefinition = {
    id: "b31c69ec-feb5-430a-a3e9-3a6f3fb8ee1c", // PLS 88
    name: "Pygmy Kavu",
    rarity: "common",
    oracleText:
        "When this creature enters, draw a card for each black creature your opponents control.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 1,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "pygmy-kavu-etb-draw",
            oracleText:
                "When this creature enters, draw a card for each black creature your opponents control.",
            scope: "self",
            effects: [
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        count: {
                            zone: "battlefield",
                            controller: "opponent",
                            filter: { type: "Creature", color: "B" },
                        },
                    },
                },
            ],
        }),
    ],
};

// Quirion Dryad — {1}{G} Creature — Dryad, 1/1. "Whenever you cast a spell
// that's white, blue, black, or red, put a +1/+1 counter on this creature."
// (CR 601.2i / 603.2 SPELL_CAST trigger, `spellCastTrigger` factory — the
// Crystal Rod color-sphere shape (`lea/colorless.ts`) with an OR-of-four-
// colors `filter.colors` array instead of one, discriminating the CAST
// SPELL's color off `SpellCastEvent.spellColors` — never this permanent's
// own color, and never a lookup. `scope: "you"` — only the controller's own
// casts. The counter is the censused `counters` Op targeting `$source`.)
export const quirionDryad: CardDefinition = {
    id: "f6841ae6-b15f-488e-9cae-2cc5ec668278", // PLS 89
    name: "Quirion Dryad",
    rarity: "rare",
    oracleText:
        "Whenever you cast a spell that's white, blue, black, or red, put a +1/+1 counter on this creature.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Dryad"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        spellCastTrigger({
            id: "quirion-dryad-grow",
            oracleText:
                "Whenever you cast a spell that's white, blue, black, or red, put a +1/+1 counter on this creature.",
            scope: "you",
            filter: { colors: ["W", "U", "B", "R"] },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
};

// Root Greevil — {3}{G} Creature — Beast, 2/3. "{2}{G}, {T}, Sacrifice this
// creature: Destroy all enchantments of the color of your choice." (CR
// 602.1 activated ability, cost `{ mana, tap, sacrifice: true }`; the
// five-way color choice reuses `colorChoiceModes` (`abilities/
// chooseColor.ts`, Caldera Kavu's own builder, `pls/red.ts`) with a
// per-mode `forEach { filter: { type: "Enchantment", color } }` + `destroy`
// sweep body instead of `setColor` — the builder's documented multi-target
// composition point, ADR 0045 "generalize, don't add".)
export const rootGreevil: CardDefinition = {
    id: "306e3429-b3b4-4186-935b-18cfc308d22c", // PLS 91
    name: "Root Greevil",
    rarity: "common",
    oracleText:
        "{2}{G}, {T}, Sacrifice this creature: Destroy all enchantments of the color of your choice.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "root-greevil-destroy-color",
            oracleText:
                "{2}{G}, {T}, Sacrifice this creature: Destroy all enchantments of the color of your choice.",
            cost: { mana: { X: 2, G: 1 }, tap: true, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "optionChoice",
                    prompt: "Choose a color.",
                    modes: colorChoiceModes((color) => [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                filter: { type: "Enchantment", color },
                            },
                            effects: [
                                { op: "destroy", target: { ref: "$each" } },
                            ],
                        },
                    ]),
                },
            ],
        },
    ],
};

// Skyshroud Blessing — {1}{G} Instant. "All lands gain shroud until end of
// turn. Draw a card." (CR 702.18 shroud grant — `forEach { set:
// "permanents", zone: "battlefield", filter: { type: "Land" } }` (no
// `controller`, so EVERY player's lands, CR 305) + `grantAbility` per
// member, then a plain `draw`. No new construct: `grantAbility`'s single-
// slot `target` composes with `forEach`'s `$each` exactly like `pump`/
// `counters` already do.
//
// The granted shroud is LIVE, not decorative: `grantAbility{ability:"shroud"}`
// routes to `ctx.grantStaticAbility`, which appends the bare keyword string
// to the target's `staticAbilities` — and `permanentGuard.ts::isGuardedAgainst`
// now bridges that string directly (the `hasShroud` helper, mirroring the
// existing `hasHexproof` bridge for CR 702.11) in its `cantBeTargeted` clause,
// unfiltered per CR 702.18. This closes the catalogue-wide dynamic-shroud-
// grant gap the Mechanics Registry's shroud row (`cards/mechanicsRegistry.ts`)
// used to document as inert (issue #959) — it now covers every dynamic grant
// site (Homarid Warrior / Svyelunite Priest `fem/blue.ts`, Sylvan Safekeeper
// `jud/green.ts`, Blurred Mongoose's activated ability `inv/green.ts`, the
// `usg/green.ts` grant) plus this card, with one engine-level fix rather than
// a per-card `permanent-guard` staticEffect.)
export const skyshroudBlessing: CardDefinition = {
    id: "c0c10b16-97b1-4a36-b2b4-f0c28ead3eb4", // PLS 92
    name: "Skyshroud Blessing",
    rarity: "uncommon",
    oracleText: "All lands gain shroud until end of turn.\nDraw a card.",
    manaCost: { X: 1, G: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Land" },
            },
            effects: [
                {
                    op: "grantAbility",
                    target: { ref: "$each" },
                    ability: "shroud",
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};

// Stone Kavu — {4}{G} Creature — Kavu, 3/3. "{R}: This creature gets +1/+0
// until end of turn.\n{W}: This creature gets +0/+1 until end of turn."
// (CR 602.1 activated abilities, off-color activation costs — Caldera
// Kavu's own off-color-cost precedent (`pls/red.ts`) — two independent
// single-mana `pump` abilities, no new construct.)
export const stoneKavu: CardDefinition = {
    id: "36a1cdca-d48c-4936-ad6a-4610aeb991ce", // PLS 93
    name: "Stone Kavu",
    rarity: "common",
    oracleText:
        "{R}: This creature gets +1/+0 until end of turn.\n{W}: This creature gets +0/+1 until end of turn.",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "stone-kavu-pump-power",
            oracleText: "{R}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { R: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "stone-kavu-pump-toughness",
            oracleText: "{W}: This creature gets +0/+1 until end of turn.",
            cost: { mana: { W: 1 } },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 0,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Thornscape Battlemage — {2}{G} Creature — Elf Wizard, 2/2. "Kicker {R}
// and/or {W}\nWhen this creature enters, if it was kicked with its {R}
// kicker, it deals 2 damage to any target.\nWhen this creature enters, if
// it was kicked with its {W} kicker, destroy target artifact." (CR 702.33a
// plural Kicker, ADR 0079 — the Battlemage cycle's own flagship shape,
// following its shipped siblings' exact template: Stormscape Battlemage
// (`pls/blue.ts`), Thunderscape Battlemage (`pls/red.ts`), Nightscape
// Battlemage (`pls/black.ts`). Two independently-payable Kickers, two
// `enteredTrigger`s each gated PER KICKER at CHECK time (CR 603.4) by
// `conditionOnSelf: kickerPaidCondition("<id>")` — the shared predicate over
// the permanent's own per-Kicker payment record — and again at RESOLUTION
// time by the `{ op: "if", predicate: { left: { kickerPaid: "<id>" }, op:
// "ge", right: 1 } }` branch inside each `effects[]`. Thornscape shipped
// (PR #2040) with NO check-time gate — the exact bug #2039 fixed for its
// three siblings while this card was in flight — so an unkicked-for-{R}
// Battlemage still announced "any target" and emitted a real `BECAME_TARGET`
// event for a trigger CR 603.4 says never came into being. Fixed to match
// the cycle (PR #2040 round 2, issue #2015). Do NOT also declare this
// predicate as `interveningIf` — see the Thunderscape Battlemage note
// (`pls/red.ts`) and issue #2042: `resolveTopOfStackInner` re-checks an
// `interveningIf` against the LIVE battlefield permanent, and a CR 400.7
// blink returns the same instance id with `kickerPayments` already cleared
// by `resetBattlefieldTransientState`, fizzling a trigger that must resolve
// off CR 608.2h last known information.
export const thornscapeBattlemage: CardDefinition = {
    id: "13f24f89-3996-4740-a6c9-d26b8869554b", // PLS 94
    rarity: "uncommon",
    name: "Thornscape Battlemage",
    oracleText:
        "Kicker {R} and/or {W} (You may pay an additional {R} and/or {W} as you cast this spell.)\nWhen this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.\nWhen this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Wizard"],
    power: 2,
    toughness: 2,
    kickers: [
        { id: "kicker-r", description: "Kicker {R}", mana: { R: 1 } },
        { id: "kicker-w", description: "Kicker {W}", mana: { W: 1 } },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "thornscape-battlemage-red-kicker",
            oracleText:
                "When this creature enters, if it was kicked with its {R} kicker, it deals 2 damage to any target.",
            scope: "self",
            // CR 603.4 per-Kicker check-time gate — see the card-level comment.
            conditionOnSelf: kickerPaidCondition("kicker-r"),
            targetRequirement: { type: "any", count: 1 },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerPaid: "kicker-r" },
                        op: "ge",
                        right: 1,
                    },
                    then: [
                        {
                            op: "dealDamage",
                            amount: 2,
                            to: { target: 0 },
                        },
                    ],
                },
            ],
        }),
        enteredTrigger({
            id: "thornscape-battlemage-white-kicker",
            oracleText:
                "When this creature enters, if it was kicked with its {W} kicker, destroy target artifact.",
            scope: "self",
            // CR 603.4 per-Kicker check-time gate — see the card-level comment.
            conditionOnSelf: kickerPaidCondition("kicker-w"),
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { kickerPaid: "kicker-w" },
                        op: "ge",
                        right: 1,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        }),
    ],
};

// Thornscape Familiar — {1}{G} Creature — Insect, 2/1. "Red spells and
// white spells you cast cost {1} less to cast." (CR 601.2f `cost-modifier`
// static effect, two-colour `appliesToSpell` filter — Nightscape Familiar's
// own two-colour shape (`pls/black.ts`) with R/W in place of U/R.)
export const thornscapeFamiliar: CardDefinition = {
    id: "76c6e426-6165-4f8e-8766-de768ae13452", // PLS 95
    name: "Thornscape Familiar",
    rarity: "common",
    oracleText: "Red spells and white spells you cast cost {1} less to cast.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 2,
    toughness: 1,
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId &&
                (ctx.getColors(card).includes("R") ||
                    ctx.getColors(card).includes("W")),
            costReduction: { X: 1 },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// PLS C4 — source-scoped prevention shields (#1955, parent PRD #1935).
// ─────────────────────────────────────────────────────────────────────────────

// Falling Timber — {2}{G} Instant. "Kicker—Sacrifice a land.\nPrevent all
// combat damage target creature would deal this turn. If this spell was
// kicked, prevent all combat damage another target creature would deal this
// turn." (CR 615 / 702.33a.)
//
// The Oracle text is the SOURCE side of prevention — "damage target creature
// would DEAL", to anyone — not the recipient side every `next-n` /
// `combat-to-and-by` shield covers. That is the `preventDamage` mode
// `"all-from-source"` with `combatOnly: true` (issue #1955): an id-scoped
// entry on `GameState.sourcePreventionShields`, checked inside
// `runDamageReplacement` so the shielded creature deals 0 to a blocker, to an
// attacking creature it blocks, and to the defending player alike.
//
// The Kicker leg is a land sacrifice (`permanent`, ADR 0079/#1937) and the
// kicked mode WIDENS the target count 1 → 2 via `kickedTargetRequirement` —
// the Magma Burst precedent in this set (`pls/red.ts`), same shape. "ANOTHER
// target creature" is the engine's distinct-targets invariant on the kicked
// requirement, not a card-level filter. The second shield is gated on
// `{ kickerCount: true } >= 1`, the standard kicker branch idiom.
export const fallingTimber: CardDefinition = {
    id: "6e54c84d-ccc9-4c52-b02c-e0392e8fe447", // PLS 79
    rarity: "common",
    name: "Falling Timber",
    oracleText:
        "Kicker—Sacrifice a land. (You may sacrifice a land in addition to any other costs as you cast this spell.)\nPrevent all combat damage target creature would deal this turn. If this spell was kicked, prevent all combat damage another target creature would deal this turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Instant"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker—Sacrifice a land",
            permanent: {
                action: "sacrifice",
                filter: { types: "Land" },
                count: 1,
            },
        },
    ],
    targetRequirement: { type: "Creature", count: 1 },
    kickedTargetRequirement: { type: "Creature", count: 2 },
    effects: [
        {
            op: "preventDamage",
            mode: "all-from-source",
            source: { target: 0 },
            combatOnly: true,
        },
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "preventDamage",
                    mode: "all-from-source",
                    source: { target: 1 },
                    combatOnly: true,
                },
            ],
        },
    ],
};
