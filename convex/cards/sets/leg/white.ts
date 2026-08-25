// Legends (LEG) — White (mono-W) cards, split by colour per ADR 0043.
// The registry's `import * as leg from "./sets/leg"` resolves through
// leg/index.ts. Modern Scryfall oracle text is authoritative (ADR 0004);
// generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
// Cards are classified by the colour identity of their mana cost (CR 202.2).

import type {
    CardDefinition,
    ManaCost,
    SpellContext,
    PermanentView,
    StaticEffectContext,
    TargetSelection,
    TriggerStateView,
} from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { tappedTrigger } from "../../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";
import { rampageTrigger } from "../../abilities/triggers/rampageTrigger";
import { combatPairKill } from "../../abilities/triggers/combatPairKillTrigger";
import { manaCostForCardId } from "../../manaCostLookup";
import { isEnchantedByAura } from "../../combatDamagePrevention";
import { makeCircleOfProtection } from "../../abilities";

// Kismet — {3}{W} Enchantment. "Artifacts, creatures, and lands your opponents
// control enter tapped." (CR 614.1c + 110.5b — a battlefield-scanned,
// player-scoped enters-tapped replacement via the `enters-tapped-restriction`
// static kind. The engine scans EVERY permanent at every ETB site
// (`entersTappedByReplacement`) and asks each source's
// `forcesTapped(entering, source, state, ctx)` predicate whether the entering
// permanent must be tapped — the symmetric analogue of how Crusade-style
// anthems (`pt-buff`) scan all permanents and buff a filtered set, and of the
// `global-attack-restriction` kind. Only OTHER players' artifacts/creatures/
// lands are affected; the controller's own permanents and non-(artifact/
// creature/land) permanents enter as usual.)
export const kismet: CardDefinition = {
    id: "7e0651ad-6901-4f9b-8807-d66e53a4ada8",
    rarity: "uncommon",
    name: "Kismet",
    oracleText:
        "Artifacts, creatures, and lands your opponents control enter tapped.",
    manaCost: { X: 3, W: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "enters-tapped-restriction",
            id: "kismet-opponents-enter-tapped",
            forcesTapped: (entering: PermanentView, source: PermanentView) => {
                // Opponent filter: "your opponents control" — the entering
                // permanent's prospective controller is NOT Kismet's controller.
                if (entering.controllerId === source.controllerId) return false;
                // Type filter: only Artifacts, Creatures, and Lands.
                return (
                    entering.types.includes("Artifact") ||
                    entering.types.includes("Creature") ||
                    entering.types.includes("Land")
                );
            },
            oracleText:
                "Artifacts, creatures, and lands your opponents control enter tapped (Kismet).",
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// White free tranche (#371) — every mono-white Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, prevention shields, SpellContext methods). Data + resolve()
// closures only; zero engine change (ADR 0014). Cards owned by feature
// clusters (#369 C1–C9: legend/world rule, Rampage, bands-with-other, named
// counters, shroud, upkeep pay-or-sacrifice, cast-tax / combat-cap World
// enchantments, global enters-tapped, end-of-turn color change) are NOT here.
// ─────────────────────────────────────────────────────────────────────────────

// --- Vanilla / keyword creatures (CR 702 — pure data) ---------------------

// Tundra Wolves — first strike (CR 702.7).
export const tundraWolves: CardDefinition = {
    id: "8f649cb5-e19c-453f-b062-4fd452d92257",
    rarity: "common",
    name: "Tundra Wolves",
    oracleText:
        "First strike (This creature deals combat damage before creatures without first strike.)",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike"],
};

// Thunder Spirit — flying, first strike (CR 702.9, 702.7).
export const thunderSpirit: CardDefinition = {
    id: "61a59775-b1cd-4ed0-8abf-c2b37f7be0d5",
    rarity: "rare",
    name: "Thunder Spirit",
    oracleText: "Flying, first strike",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Spirit"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying", "first strike"],
};

// Wall of Light — Defender, protection from black (CR 702.3, 702.16).
export const wallOfLight: CardDefinition = {
    id: "f5758e82-f901-42b7-b705-0e68ca7ba59e",
    rarity: "uncommon",
    name: "Wall of Light",
    oracleText: "Defender (This creature can't attack.)\nProtection from black",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender", "protection from black"],
};

// Righteous Avengers — plainswalk (CR 702.14 landwalk variant).
export const righteousAvengers: CardDefinition = {
    id: "d96b463e-9579-4e7b-87c2-342527b91e7c",
    rarity: "uncommon",
    name: "Righteous Avengers",
    oracleText:
        "Plainswalk (This creature can't be blocked as long as defending player controls a Plains.)",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 3,
    toughness: 1,
    staticAbilities: ["plainswalk"],
};

// Great Wall — global plainswalk negation (CR 509.1b / 702.14). The
// `landwalk-negation` static is scanned across the defending player's
// battlefield by the keyword-evasion pass (`combatRegistry.ts`): a creature
// with plainswalk can then be blocked as though it didn't have it, regardless
// of the defender's Plains. Parametric `subtypes` shares one kind with
// Undertow (Island) and the LEG suppression statics (Gosta Dirk et al.).
export const greatWall: CardDefinition = {
    id: "cd860a1d-aa17-4579-b9b1-d101d2416387",
    rarity: "uncommon",
    name: "Great Wall",
    oracleText:
        "Creatures with plainswalk can be blocked as though they didn't have plainswalk.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "landwalk-negation",
            id: "great-wall-plainswalk-negation",
            subtypes: ["Plains"],
            oracleText:
                "Creatures with plainswalk can be blocked as though they didn't have plainswalk.",
        },
    ],
};

// Keepers of the Faith — vanilla 2/3 (CR 208 — stats only).
export const keepersOfTheFaith: CardDefinition = {
    id: "b63a69ae-99ce-4d26-88b7-784793c43cd4",
    rarity: "common",
    name: "Keepers of the Faith",
    oracleText: "",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 3,
};

// D'Avenant Archer — {T}: deal 1 damage to target attacking or blocking
// creature (CR 508.1 / 509.1 combat-role-restricted target). "Attacking or
// blocking" is the array form of `combatRoleFilter` (a single role can't
// express the union). Standard tap-to-ping; no summoning-sickness exception.
export const davenantArcher: CardDefinition = {
    id: "b09aee5c-8b9e-46c2-b4d4-508062f8af05",
    rarity: "common",
    name: "D'Avenant Archer",
    oracleText:
        "{T}: This creature deals 1 damage to target attacking or blocking creature.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier", "Archer"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "davenant-archer-ping",
            oracleText:
                "{T}: This creature deals 1 damage to target attacking or blocking creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: ["attacking", "blocking"],
            },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

// --- Continuous source-filtered combat-damage prevention (CR 615 / 611) ----
//
// A `combat-damage-prevention` static effect is carried by the creature taking
// damage and evaluated LIVE at the combat-damage step (convex/gre/
// combatDamagePrevention.ts) — re-applied every combat for as long as the
// creature is on the battlefield, NOT a one-shot turn-scoped shield. Each
// effect's `prevents(self, damageSource, state, ctx)` predicate filters on the
// damage SOURCE.

// Enchanted Being — {1}{W}{W} 2/2. "Prevent all combat damage that would be
// dealt to this creature by enchanted creatures." Source filter: the attacker/
// blocker is enchanted by any Aura (CR 303.4b).
export const enchantedBeing: CardDefinition = {
    id: "94c2880d-b37a-43ea-9fee-cd5a8ed75a7e",
    rarity: "common",
    name: "Enchanted Being",
    oracleText:
        "Prevent all combat damage that would be dealt to this creature by enchanted creatures.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "combat-damage-prevention",
            id: "enchanted-being-prevent",
            oracleText:
                "Prevent all combat damage that would be dealt to this creature by enchanted creatures.",
            prevents: (_self, damageSource, state) =>
                isEnchantedByAura(damageSource, state),
        },
    ],
};

// --- Block / evasion restriction creatures (CR 509.1b) --------------------

// Amrou Kithkin — can't be blocked by power 3 or greater (CR 509.1b). The
// block-restriction predicate receives the candidate blocker enriched to
// effective power (post-layer-7c) by the combat validator.
export const amrouKithkin: CardDefinition = {
    id: "cbce1c55-123c-4a05-bde4-18a1601fcc5a",
    rarity: "common",
    name: "Amrou Kithkin",
    oracleText:
        "This creature can't be blocked by creatures with power 3 or greater.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Kithkin"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "block-restriction",
            id: "amrou-kithkin-low-power-only",
            side: "attacker",
            // self = attacker, opponent = candidate blocker (enriched P/T).
            predicate: (_self, opponent) => (opponent.power ?? 0) < 3,
            oracleText:
                "This creature can't be blocked by creatures with power 3 or greater.",
        },
    ],
};

// --- Conditional anthems (CR 611 layer 7c, staticEffects + condition) ------

// Angelic Voices — "Creatures you control get +1/+1 as long as you control no
// nonartifact, nonwhite creatures." A source-level `condition` gates the whole
// anthem on the board state (CR 611.2c).
export const angelicVoices: CardDefinition = {
    id: "8068c263-e5fa-4449-8887-418e9d0a4da4",
    rarity: "rare",
    name: "Angelic Voices",
    oracleText:
        "Creatures you control get +1/+1 as long as you control no nonartifact, nonwhite creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId,
            condition: (source, state, ctx) => {
                // No creature the controller controls may be both nonartifact
                // and nonwhite.
                return !state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId === source.controllerId &&
                            ctx.isCreature(c) &&
                            !c.types.includes("Artifact") &&
                            !ctx.getColors(c).includes("W")
                    )
                );
            },
            power: 1,
            toughness: 1,
        },
    ],
};

// Ivory Guardians — protection from red (CR 702.16) + a conditional anthem
// scoped to creatures named Ivory Guardians (CR 611.2c).
const IVORY_GUARDIANS_ID = "9bf9cccd-fe97-4632-a90a-9eeb0d41135e";

export const ivoryGuardians: CardDefinition = {
    id: IVORY_GUARDIANS_ID,
    rarity: "uncommon",
    name: "Ivory Guardians",
    oracleText:
        "Protection from red\nCreatures named Ivory Guardians get +1/+1 as long as an opponent controls a nontoken red permanent.",
    manaCost: { X: 4, W: 2 },
    types: ["Creature"],
    subtypes: ["Giant", "Cleric"],
    power: 3,
    toughness: 3,
    staticAbilities: ["protection from red"],
    staticEffects: [
        {
            kind: "pt-buff",
            // "Creatures named Ivory Guardians" — every copy shares the same
            // card-definition id (CR 201.2), so match on id rather than reading
            // a name off the slim projected view.
            applies: (target) =>
                (target.card as { id?: string }).id === IVORY_GUARDIANS_ID,
            condition: (source, state, ctx) =>
                state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            !c.isToken &&
                            ctx.getColors(c).includes("R")
                    )
                ),
            power: 1,
            toughness: 1,
        },
    ],
};

// Fortified Area — "Wall creatures you control get +1/+0 and have banding."
// (CR 611 — filtered anthem + keyword grant; plain banding is already shipped.)
export const fortifiedArea: CardDefinition = {
    id: "dc64f19c-5b2b-4697-b4dc-2be9c3790794",
    rarity: "uncommon",
    name: "Fortified Area",
    oracleText: "Wall creatures you control get +1/+0 and have banding.",
    manaCost: { X: 1, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Wall"),
            power: 1,
            toughness: 0,
        },
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Wall"),
            keyword: "banding",
        },
    ],
};

// --- Auras (CR 303 — Enchant creature) ------------------------------------

// Divine Transformation — Enchanted creature gets +3/+3 (CR 303.4, 611).
export const divineTransformation: CardDefinition = {
    id: "a89ad9fd-33a6-4d31-9f4c-8bf192882f21",
    rarity: "rare",
    name: "Divine Transformation",
    oracleText: "Enchant creature\nEnchanted creature gets +3/+3.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 3,
            toughness: 3,
        },
    ],
};

// Seeker — "Enchanted creature can't be blocked except by artifact creatures
// and/or white creatures." (CR 509.1b block restriction via the aura's host.)
export const seeker: CardDefinition = {
    id: "df608b59-cc07-4e1d-b6d6-f15e69b15b92",
    rarity: "uncommon",
    name: "Seeker",
    oracleText:
        "Enchant creature\nEnchanted creature can't be blocked except by artifact creatures and/or white creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "block-restriction",
            id: "seeker-artifact-or-white-only",
            side: "attacker",
            // opponent = candidate blocker. Legal only if it is an artifact
            // creature or a white creature (CR 202.2 colour from mana cost).
            predicate: (_self, opponent) =>
                opponent.types.includes("Artifact") ||
                colorsOf(opponent).includes("W"),
            oracleText:
                "Enchanted creature can't be blocked except by artifact creatures and/or white creatures.",
        },
    ],
};

// Spirit Link — "Whenever enchanted creature deals damage, you gain that much
// life." (CR 303.4 aura host trigger via the damage-dealt factory.)
export const spiritLink: CardDefinition = {
    id: "5e2d35f8-3cf6-4843-9030-0e9a885d836c",
    rarity: "uncommon",
    name: "Spirit Link",
    oracleText:
        "Enchant creature (Target a creature as you cast this. This card enters attached to that creature.)\nWhenever enchanted creature deals damage, you gain that much life.",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        damageDealtTrigger({
            id: "spirit-link-lifegain",
            oracleText:
                "Whenever enchanted creature deals damage, you gain that much life.",
            // The damage source must be the aura's host (CR 303.4b).
            source: "any",
            condition: (event, self) =>
                event.sourceInstanceId === self.attachedTo,
            // NOT DSL-migratable (ADR 0045): the lifegain amount is
            // `event.amount` (DAMAGE_DEALT's damage amount) — a numeric
            // firing-event field. `EVENT_FIELD_REGISTRY` (ADR 0049) only
            // censuses `object`/`player` family `$event.<field>` refs, no
            // numeric family, and DAMAGE_DEALT's rows (`damagedPlayer`/
            // `damagedPermanent`) are both object/player, not the amount.
            // Blocked on: a numeric $event ref family. Stays resolve().
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};

// Infinite Authority — {W}{W}{W} Aura (Enchant creature). "Whenever enchanted
// creature blocks or becomes blocked by a creature with toughness 3 or less,
// destroy the other creature at end of combat. At the beginning of the next end
// step, if that creature was destroyed this way, put a +1/+1 counter on the
// first creature." (CR 303.4 aura, CR 509.1h combat-pairing trigger, CR 603.7a
// delayed end-of-combat destroy + next-end-step counter.)
//
// Composed entirely from shared primitives: `combatPairKill` (becomes-blocked
// → deferred destroy) with `combatant: "enchanted"` and a toughness-≤3 gate; (tracked-by: #2785)
// the `onDestroyed` hook (fired only when the destroy actually hit a graveyard)
// schedules the next-end-step +1/+1 counter on the aura's host — that scheduling
// IS the "destroyed this way" marker, so no persisted flag is needed.
const INFINITE_AUTHORITY_ID = "dc60077f-d577-4a6c-a78f-697317024c40";

const INFINITE_AUTHORITY_COUNTER_TRIGGER = "infinite-authority-counter";

const infiniteAuthorityCombatKill = combatPairKill({
    cardId: INFINITE_AUTHORITY_ID,
    triggerId: "infinite-authority-combat-kill",
    delayedTriggerId: "infinite-authority-destroy",
    oracleText:
        "Whenever enchanted creature blocks or becomes blocked by a creature with toughness 3 or less, destroy the other creature at end of combat.",
    delayedOracleText: "Destroy the other creature at end of combat.",
    combatant: "enchanted",
    // "a creature with toughness 3 or less" (CR 613 effective toughness carried
    // on the event). Treat a missing toughness (synthetic events) as not-≤3.
    opponentFilter: (opponent) =>
        opponent.toughness !== undefined && opponent.toughness <= 3,
    // "if that creature was destroyed this way, put a +1/+1 counter on the
    // first creature [the enchanted creature] at the beginning of the next end
    // step." Scheduled only when the destroy succeeded. `ownId` is the host
    // captured at trigger resolution (the delayed-destroy ctx can't read
    // `getAttachedToId`).
    onDestroyed: (ctx, payload) => {
        const hostId = payload.ownId;
        if (!hostId) return;
        ctx.scheduleDelayedTrigger(
            INFINITE_AUTHORITY_ID,
            INFINITE_AUTHORITY_COUNTER_TRIGGER,
            "next-end-step",
            { hostId }
        );
    },
});

export const infiniteAuthority: CardDefinition = {
    id: INFINITE_AUTHORITY_ID,
    rarity: "rare",
    name: "Infinite Authority",
    oracleText:
        "Enchant creature\nWhenever enchanted creature blocks or becomes blocked by a creature with toughness 3 or less, destroy the other creature at end of combat. At the beginning of the next end step, if that creature was destroyed this way, put a +1/+1 counter on the first creature.",
    manaCost: { W: 3 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [infiniteAuthorityCombatKill.trigger],
    delayedTriggers: [
        infiniteAuthorityCombatKill.delayed,
        {
            id: INFINITE_AUTHORITY_COUNTER_TRIGGER,
            oracleText: "Put a +1/+1 counter on the first creature.",
            timing: "next-end-step",
            // NOT DSL-migratable (ADR 0045): a delayed-trigger body whose counter
            // target is a captured `payload.hostId` (an event-field capture from
            // the combat-kill scheduling) — not a covered `EffectObjectSelector`
            // (announced slot / `$source` / `$each`). Stays resolve().
            resolve: (ctx: SpellContext, payload: Record<string, string>) => {
                if (!payload.hostId) return;
                // CR 122 — +1/+1 counter on the enchanted creature (the "first
                // creature"). No-op if the host has since left the battlefield.
                ctx.addCounter(
                    { type: "permanent", id: payload.hostId },
                    "+1/+1",
                    1
                );
            },
        },
    ],
};

// --- Sweepers / removal spells (CR 701.7) ----------------------------------

// Cleanse — "Destroy all black creatures." (CR 701.8 mass destroy filtered on
// colour, CR 202.2.)
// Migrated resolve()→effects[] (ADR 0045): `forEach` over every player's
// battlefield creatures filtered to color B (CR 202.2) → `destroy` each.
export const cleanse: CardDefinition = {
    id: "2fbd611b-ac97-4516-bad7-cc9ee4ef74f7",
    rarity: "rare",
    name: "Cleanse",
    oracleText: "Destroy all black creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", color: "B" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};

// Divine Offering — "Destroy target artifact. You gain life equal to its mana
// value." (CR 701.8 + 118.3 lifegain; snapshot the MV before the destroy.)
// Migrated resolve()→effects[] (ADR 0045): `destroy` binds the target's
// snapshot (captures mana value BEFORE it leaves the battlefield, CR 608.2h —
// the Swords to Plowshares shape) → `gainLife` reads it back via `ref`.
export const divineOffering: CardDefinition = {
    id: "9c78c2f3-2f40-48ad-9dc4-55d1fa399a56",
    rarity: "common",
    name: "Divine Offering",
    oracleText:
        "Destroy target artifact. You gain life equal to its mana value.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 }, bind: "$art" },
        {
            op: "gainLife",
            player: "controller",
            amount: { ref: "$art.manaValue" },
        },
    ],
};

// Remove Enchantments — "Return to your hand all enchantments you both own and
// control, all Auras you own attached to permanents you control, and all Auras
// you own attached to attacking creatures your opponents control. Then destroy
// all other enchantments you control, all other Auras attached to permanents
// you control, and all other Auras attached to attacking creatures your
// opponents control."
//
// The affected category (CR 110.2 control, 303.4b attachment, 508.1 attacking)
// is the union of: (a) enchantments the caster controls, (b) Auras attached to
// a permanent the caster controls, (c) Auras attached to an attacking creature
// an opponent controls. Within that category, ownership (CR 108.3, immutable)
// splits the outcome: an object the caster owns is RETURNED to hand (CR 400.7),
// everything else is DESTROYED (CR 701.8). Order matters — return first so a
// returned card is no longer on the battlefield when the destroy sweep runs
// (CR 608.2 — sequential one-shot effect; a card that left play is untouched by
// the later step). No target: it's a mass effect (CR 608.2 reads the board at
// resolution).
export const removeEnchantments: CardDefinition = {
    id: "bf2e3a8a-b386-474d-b8e9-4c2d56a2b742",
    rarity: "common",
    name: "Remove Enchantments",
    oracleText:
        "Return to your hand all enchantments you both own and control, all Auras you own attached to permanents you control, and all Auras you own attached to attacking creatures your opponents control. Then destroy all other enchantments you control, all other Auras attached to permanents you control, and all other Auras attached to attacking creatures your opponents control.",
    manaCost: { W: 1 },
    types: ["Instant"],
    // NOT DSL-migratable (ADR 0045): the affected category is a three-way
    // union — enchantments the caster controls, PLUS Auras filtered on their
    // ATTACHMENT HOST's controller/attacking-status — then split return-vs-
    // destroy by OWNERSHIP (CR 108.3, independent of the selection filter).
    // Blocked on: `EffectCardFilter`/`PermanentFilter` (forEach's `filter`)
    // have no attachment-host predicate (host controller / host isAttacking),
    // and no construct expresses "select by one predicate, branch the ACTION
    // per-member by a second, unrelated predicate (ownership)". Stays
    // resolve().
    resolve: (ctx: SpellContext) => {
        const me = ctx.caster;
        const opponents = ctx.allPlayerIds.filter((p) => p !== me);

        // Collect the affected category up front: three disjoint groups. We
        // snapshot ids before mutating so the return/destroy passes operate on
        // a fixed set (CR 608.2 — last-known information at resolution). The
        // oracle has NO blanket "Auras you control" clause: an Aura qualifies
        // only by its attachment (group b/c), not merely by the caster
        // controlling it (e.g. a control-Aura the caster put on a non-attacking
        // opponent permanent is untouched).
        const affected: string[] = [];

        // (a) Non-Aura enchantments the caster controls (CR 110.2). Auras are
        //     excluded here and handled by attachment below.
        for (const id of ctx.getBattlefieldIds(me, { types: "Enchantment" })) {
            if (ctx.getAttachedTo(id) === undefined) affected.push(id);
        }

        // (b/c) Auras (controlled by anyone, on any battlefield) attached
        //       either to a permanent the caster controls, or to an attacking
        //       creature an opponent controls.
        for (const p of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(p, {
                types: "Enchantment",
                subtypes: "Aura",
            })) {
                const hostId = ctx.getAttachedTo(id);
                if (hostId === undefined) continue;
                const hostController = ctx.getController({
                    type: "permanent",
                    id: hostId,
                });
                const attachedToMine = hostController === me;
                const onOpponentAttacker =
                    opponents.includes(hostController) &&
                    ctx.getIsAttacking(hostId);
                if (attachedToMine || onOpponentAttacker) affected.push(id);
            }
        }

        // De-dupe (an Aura the caster controls attached to their own permanent
        // can match both passes).
        const ids = [...new Set(affected)];

        // Step 1 — return to hand everything in the category the caster OWNS
        // (CR 108.3 ownership, CR 400.7 return). Must run before the destroy
        // sweep so these cards are off the battlefield and untouched by step 2.
        const returned = new Set<string>();
        for (const id of ids) {
            if (ctx.getOwnerId(id) === me) {
                ctx.returnToHand({ type: "permanent", id });
                returned.add(id);
            }
        }

        // Step 2 — destroy the remainder of the category (CR 701.8). Cards
        // returned in step 1 are no longer on the battlefield, so destroy is a
        // no-op for them anyway; we skip them explicitly for clarity.
        for (const id of ids) {
            if (!returned.has(id)) ctx.destroy({ type: "permanent", id });
        }
    },
};

// --- Pump spells (CR 611.1, end-of-turn duration) --------------------------

// Great Defender — "Target creature gets +0/+X until end of turn, where X is
// its mana value." (CR 202.3 mana value snapshot + 611.1 temporary buff.)
export const greatDefender: CardDefinition = {
    id: "879a8653-1538-4f78-a3d3-a900a4d9499b",
    rarity: "uncommon",
    name: "Great Defender",
    oracleText:
        "Target creature gets +0/+X until end of turn, where X is its mana value.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // NOT DSL-migratable (ADR 0045, issue #840): the toughness delta is a
    // non-literal amount derived from the target's mana value (getManaValue).
    // Blocked on: an X-value / mana-value construct, not pump.
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const mv = ctx.getManaValue(target);
        ctx.addTemporaryPTBuff(target, 0, mv, { phase: "end-of-turn" });
    },
};

// Shield Wall — "Creatures you control get +0/+2 until end of turn." (CR 611.1
// one-shot team buff applied per matching permanent.)
export const shieldWall: CardDefinition = {
    id: "a5032bf0-f9c0-4ef0-8ec2-fe7ccea9bdf3",
    rarity: "uncommon",
    name: "Shield Wall",
    oracleText: "Creatures you control get +0/+2 until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045, #840): `forEach` over the
    // caster's battlefield creatures (CR 110/205) → `pump` each +0/+2 until
    // end of turn (CR 611.1).
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                controller: "controller",
                filter: { type: "Creature" },
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$each" },
                    power: 0,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// --- Damage prevention (CR 615) --------------------------------------------

// Holy Day — "Prevent all combat damage that would be dealt this turn."
// (CR 615 — the global combat-damage prevention used by Fog-style cards.)
export const holyDay: CardDefinition = {
    id: "f6c95a2b-bf44-4ff2-9c6a-916773346edd",
    rarity: "common",
    name: "Holy Day",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    // Migrated resolve()→effects[] (ADR 0045, #845): the "all-combat" mode of
    // preventDamage is a turn-scoped global Fog (CR 615).
    effects: [{ op: "preventDamage", mode: "all-combat" }],
};

// Indestructible Aura — "Prevent all damage that would be dealt to target
// creature this turn." (CR 615 — a per-target shield. "All damage" is modeled
// as a very large prevention amount consumed across the turn.)
export const indestructibleAura: CardDefinition = {
    id: "ed2a7333-c9ce-4011-b00e-1304e1eec25e",
    rarity: "common",
    name: "Indestructible Aura",
    oracleText:
        "Prevent all damage that would be dealt to target creature this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    // Migrated resolve()→effects[] (ADR 0045, #845): a per-target prevention
    // shield (CR 615.1). "All damage" is modeled as a very large prevention
    // amount consumed across the turn — the exact shape the closure used.
    effects: [
        {
            op: "preventDamage",
            mode: "next-n",
            to: { target: 0 },
            amount: 9999,
            duration: { phase: "end-of-turn" },
        },
    ],
};

// Alabaster Potion — modal: "Target player gains X life" OR "Prevent the next X
// damage that would be dealt to any target this turn." (CR 700.2 modal spell.)
export const alabasterPotion: CardDefinition = {
    id: "2806c7f6-8fdd-4e65-9c71-f2e8b0cdede2",
    rarity: "common",
    name: "Alabaster Potion",
    oracleText:
        "Choose one —\n• Target player gains X life.\n• Prevent the next X damage that would be dealt to any target this turn.",
    manaCost: { X: "X", W: 2 },
    types: ["Instant"],
    // NOT DSL-migratable (ADR 0045, #852): a MODAL "choose one" card. `effects[]`
    // is mutually exclusive with `modes`, and there is no mode-level Effect
    // Script yet (the `optionChoice` Op covers spell-level modal wrappers, not
    // the per-mode `targetRequirement` split `modes` needs). Both modes' bodies
    // now use only covered Ops + X (gainLife / preventDamage), so the classifier
    // over-counts each as X-only. Blocked on mode-level effects[], not on X
    // (same class as Healing Salve).
    modes: [
        {
            id: "gain-life",
            label: "Target player gains X life",
            oracleText: "Target player gains X life.",
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "player") {
                    ctx.gainLife(target.id, ctx.getX());
                }
            },
        },
        {
            id: "prevent",
            label: "Prevent the next X damage to any target",
            oracleText:
                "Prevent the next X damage that would be dealt to any target this turn.",
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (!target) return;
                ctx.preventNextNDamageToTarget(target, ctx.getX(), {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// --- Enchantment triggers (CR 603) -----------------------------------------

// Spiritual Sanctuary — "At the beginning of each player's upkeep, if that
// player controls a Plains, they gain 1 life." (CR 603.6a + 603.4 if-clause.)
export const spiritualSanctuary: CardDefinition = {
    id: "654dd1e0-a91d-44ee-af20-c025bf360c3f",
    rarity: "rare",
    name: "Spiritual Sanctuary",
    oracleText:
        "At the beginning of each player's upkeep, if that player controls a Plains, they gain 1 life.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "spiritual-sanctuary-lifegain",
            oracleText:
                "At the beginning of each player's upkeep, if that player controls a Plains, they gain 1 life.",
            phase: "UPKEEP",
            scope: "each",
            interveningIf: (event, _self, state) => {
                const p = state?.players.find(
                    (pl) => pl.id === event.activePlayerId
                );
                return !!p?.battlefield.some((c) =>
                    c.subtypes.includes("Plains")
                );
            },
            // Migrated resolve()→effects[] (ADR 0045, issue #1066): `scope:
            // "each"` means the plain `"controller"` player selector would
            // read the ABILITY's controller, not the scoped (upkeep) player —
            // read the scoped player straight off the firing event instead
            // via the censused `PHASE_BEGIN.activePlayerId` $event ref
            // (EVENT_FIELD_REGISTRY, ADR 0049), exactly as `phaseTrigger`'s
            // own doc comment prescribes for `each`/`opponents` scripts.
            effects: [
                {
                    op: "gainLife",
                    player: { ref: "$event.activePlayerId" },
                    amount: 1,
                },
            ],
        }),
    ],
};

// Lifeblood — "Whenever a Mountain an opponent controls becomes tapped, you
// gain 1 life." (CR 701.26a tap trigger, scoped to opponents' Mountains.)
export const lifeblood: CardDefinition = {
    id: "4ecb1362-9a67-4d4c-8d69-9ac2ebf4d0b0",
    rarity: "rare",
    name: "Lifeblood",
    oracleText:
        "Whenever a Mountain an opponent controls becomes tapped, you gain 1 life.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        tappedTrigger({
            id: "lifeblood-mountain-tapped",
            oracleText:
                "Whenever a Mountain an opponent controls becomes tapped, you gain 1 life.",
            scope: "opponents",
            filter: { types: "Land", subtypes: "Mountain" },
            // NOT DSL-migratable (ADR 0045): the effect body itself is a
            // trivial `gainLife(controller, 1)` — but the `tappedTrigger`
            // factory (convex/cards/abilities/triggers/tappedTrigger.ts) has
            // no `effects[]` parameter, unlike `phaseTrigger` /
            // `damageDealtTrigger` / `spellCastTrigger`, which all accept
            // `effects` as an alternative to `resolve`. Blocked on: the
            // shared factory itself, not on Op/value coverage — extending it
            // is out of scope for a single-card migration. Stays resolve().
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Presence of the Master — "Whenever a player casts an enchantment spell,
// counter it." (CR 601.2i cast trigger → CR 701.6a counter.)
export const presenceOfTheMaster: CardDefinition = {
    id: "1cb86b2f-116d-4952-b35a-1398341baaf5",
    rarity: "uncommon",
    name: "Presence of the Master",
    oracleText: "Whenever a player casts an enchantment spell, counter it.",
    manaCost: { X: 3, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "presence-of-the-master-counter",
            oracleText:
                "Whenever a player casts an enchantment spell, counter it.",
            scope: "any",
            filter: { types: ["Enchantment"] },
            // NOT DSL-migratable (ADR 0045): `counter`'s target is the
            // firing SPELL_CAST event's own `spellInstanceId` — not an
            // announced target, a bound snapshot, nor a `forEach` member.
            // `EVENT_FIELD_REGISTRY` (ADR 0049) has no SPELL_CAST row at all
            // (no censused `$event.<field>`), so there is no ref that names
            // "the spell that triggered this". Blocked on: an
            // EVENT_FIELD_REGISTRY row for SPELL_CAST.spellInstanceId. Stays
            // resolve().
            resolve: (ctx, _event, spell) => {
                ctx.counter({ type: "spell", id: spell.instanceId });
            },
        }),
    ],
};

// --- Library inspection (CR 401) -------------------------------------------

// Visions — "Look at the top five cards of target player's library. You may
// then have that player shuffle that library." (CR 401.4 look → markKnown to
// the caster; optional shuffle, CR 701.24.)
export const visions: CardDefinition = {
    id: "21d00299-e183-4b3d-b015-18808e7135b9",
    rarity: "uncommon",
    name: "Visions",
    oracleText:
        "Look at the top five cards of target player's library. You may then have that player shuffle that library.",
    manaCost: { W: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    // NOT DSL-migratable (ADR 0045): "look at the top five" marks them known
    // to the CASTER only, WITHOUT moving or reordering them — no Op covers a
    // pure look. `libraryLook` only implements `action: "shuffle"`;
    // `lookDistribute` / `digMatchingToHand` / `scryReorder` all move or reorder
    // the looked-at cards, which Visions' first clause must NOT do. Blocked
    // on: a plain "look, mark known, leave in place" Op (the classifier's
    // stale `scryReorder` backlog note calls this same gap out for
    // Ponder/Preordain-family cards). The second clause (mayPay + shuffle)
    // is itself trivially Op-expressible, but the two clauses share one
    // `resolveSteps` body — stays resolve()/resolveSteps as a whole.
    resolveSteps: [
        (ctx: SpellContext) => {
            const target = ctx.targets[0];
            if (target?.type !== "player") return;
            const top = ctx.peekLibraryTop(target.id, 5);
            ctx.markKnown(target.id, top, ctx.caster);
            const shuffle = ctx.requestMayPay({
                playerId: ctx.caster,
                choiceId: "visions-shuffle",
                prompt: "Have that player shuffle their library?",
            });
            if (shuffle === undefined) return; // suspended
            if (shuffle) ctx.shuffleLibrary(target.id);
        },
    ],
};

// Equinox — {W} Aura (Enchant land). "Enchanted land has '{T}: Counter target
// spell if it would destroy a land you control.'" (CR 303.4 aura attachment,
// 611.2 continuous ability grant via `activated-grant`, 701.5a counter, 701.7
// destroy.) The granted {T} ability lives on `grantTemplates` (kept off the
// Aura's own `activatedAbilities` so Equinox itself doesn't expose it) and is
// spliced onto the enchanted land by the layer system. Its target requirement
// `spellWouldDestroyLandYouControl` limits legal targets to spells that would
// directly destroy a land the activating player controls — Stone Rain / Sinkhole
// targeting your land, or Armageddon-style mass land destruction. Per the
// Legends rulings, indirect/random/sacrifice destruction and damage to animated
// lands are excluded (they aren't `destroy-target` / `destroysAllLands`).
export const equinox: CardDefinition = {
    id: "840c6586-a7a9-4ae8-96be-a995a0693eb6",
    rarity: "common",
    name: "Equinox",
    oracleText:
        'Enchant land\nEnchanted land has "{T}: Counter target spell if it would destroy a land you control."',
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    staticEffects: [
        {
            kind: "activated-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "equinox-counter-land-destruction",
        },
    ],
    grantTemplates: [
        {
            id: "equinox-counter-land-destruction",
            oracleText:
                "{T}: Counter target spell if it would destroy a land you control.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                spellWouldDestroyLandYouControl: true,
            },
            effects: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};

/** Colour of a permanent view (CR 202.2), derived from its registered mana
 *  cost. Used by the Seeker block predicate, which receives a raw permanent
 *  view (no `StaticEffectContext`). Production instances carry only `{ id }` on
 *  `card`, so the cost is looked up cycle-safely via `manaCostForCardId`; test
 *  fixtures that inline `manaCost` on the view are honoured first. */
function colorsOf(view: { card: Record<string, unknown> }): string[] {
    const inlined = (view.card as { manaCost?: ManaCost }).manaCost;
    const cardId = (view.card as { id?: string }).id;
    const cost = inlined ?? (cardId ? manaCostForCardId(cardId) : undefined);
    if (!cost) return [];
    return (["W", "U", "B", "R", "G"] as const).filter(
        (c) => (cost[c] ?? 0) > 0
    );
}

// Osai Vultures — flying 1/1 with a carrion-counter death engine. Mirrors the
// Scavenging Ghoul / Khabál Ghoul "end-step death-tally accrual" shape, but
// (a) accrues a NAMED `carrion` counter (CR 122.1) gated by a CR 603.4
// intervening-if ("if a creature died this turn" — at most one counter per
// turn regardless of how many died, per the card's printed ruling), and
// (b) spends two of those counters as a CR 122.6 / 118.5 activation cost to
// pump itself +1/+1 until end of turn (CR 611.1 temporary buff, expires at
// CLEANUP CR 514.2). The `deathsThisTurn` tally is the shared CR 700.4 death
// counter maintained in `removePermanentTo` and reset at turn start.
export const osaiVultures: CardDefinition = {
    id: "f85614b3-62a3-4da9-a74a-7ea40fad1b52",
    rarity: "common",
    name: "Osai Vultures",
    oracleText:
        "Flying\nAt the beginning of each end step, if a creature died this turn, put a carrion counter on this creature.\nRemove two carrion counters from this creature: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "osai-vultures-carrion",
            oracleText:
                "At the beginning of each end step, if a creature died this turn, put a carrion counter on this creature.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4 intervening-if: the trigger only fires (and only
            // resolves) while at least one creature has died this turn. A
            // single carrion counter is placed regardless of the death count
            // (the singular "a creature died this turn" condition, not a
            // per-creature count like Khabál Ghoul / Scavenging Ghoul).
            interveningIf: (_event, _self, state) =>
                (state?.deathsThisTurn ?? 0) > 0,
            // CR 122 (issue #841) — put one carrion counter on the source. The
            // "a creature died this turn" gate is the trigger's interveningIf
            // (CR 603.4); the effect itself is a fixed single-counter add.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "carrion",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "osai-vultures-pump",
            oracleText:
                "Remove two carrion counters from this creature: This creature gets +1/+1 until end of turn.",
            // CR 122.6 / 118.5 — counter-removal as an activation cost; the
            // ability is only legal while the source has >= 2 carrion counters.
            cost: { removeCounter: { type: "carrion", count: 2 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #840): self-pump +1/+1
            // until end of turn (CR 611.1) via the `pump` Op. Counter removal
            // stays as the activation cost.
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Glyph of Life — "Choose target Wall creature. Whenever that creature is dealt
// damage by an attacking creature this turn, you gain that much life." A
// turn-scoped delayed lifegain (CR 603.7 / 119) keyed to the chosen Wall, armed
// at resolution and scanned in the combat damage step: only damage from an
// attacker (CR 506.2) gains life — a blocker's or non-combat source's damage
// does not. The watch wears off at CLEANUP (CR 514.2).
export const glyphOfLife: CardDefinition = {
    id: "ba1384e5-d140-4074-9548-250af09cb413",
    rarity: "common",
    name: "Glyph of Life",
    oracleText:
        "Choose target Wall creature. Whenever that creature is dealt damage by an attacking creature this turn, you gain that much life.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        subtypeFilter: "Wall",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        ctx.gainLifeWhenDamagedByAttacker(target, { phase: "end-of-turn" });
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// C3 — Rampage N (CR 702.23) — issue #380.
//
// "Rampage N means 'Whenever this creature becomes blocked, it gets +N/+N until
// end of turn for each creature blocking it beyond the first.'" (CR 702.23a).
// The bonus is computed as the ability resolves (CR 702.23b), so a blocker
// removed after blocks are declared but before resolution lowers it. The
// parametric keyword `"rampage N"` rides in `staticAbilities[]` (board-visible
// reminder data); the matching triggered ability is built by the shared
// `rampageTrigger(N)` factory (ADR 0002) — no per-card trigger code.
//
// All seven LEG Rampage creatures ship here. Chromium also has Flying (a static
// keyword, expressible today) and an upkeep pay-or-sacrifice clause that belongs
// to the C7 maintenance-cost cluster (#369); only its Rampage and Flying land
// here, so it is partially complete until C7 attaches the upkeep trigger.
// ─────────────────────────────────────────────────────────────────────────────

// Rapid Fire — {3}{W} Instant. "Cast this spell only before blockers are
// declared. Target creature gains first strike until end of turn. If it doesn't
// have rampage, that creature gains rampage 2 until end of turn."
//
// Composition (no new card-shaped primitive):
//   • Cast timing (CR 117.1b) — castable only up to and including the
//     declare-attackers step, so the allow-list is every pre-blocker phase
//     where an instant can be cast. Reuses the parametric `castPhaseRestriction`
//     plumbing (shared by Teleport / Berserk); enforced in rules.ts and game.ts.
//   • First strike until end of turn (CR 702.7, 611.2a layer 6) —
//     `grantStaticAbility(target, "first strike", end-of-turn)`.
//   • Conditional rampage 2 until end of turn (CR 702.23) — only if the target
//     has no rampage at resolution. "Has rampage" is read from the effective
//     keywords (`getStaticAbilities`, prefix "rampage"), so a creature already
//     carrying rampage 1/2/3 (or one granted earlier this turn) gets nothing
//     extra. When granted: push the board-visible `"rampage 2"` keyword AND the
//     matching `rampageTrigger(2)` (carried on `triggeredGrantTemplates`) for
//     end of turn, mirroring how the printed rampage creatures pair the keyword
//     with the trigger (ADR 0002).
export const rapidFire: CardDefinition = {
    id: "e26e7c9c-e6de-47f4-8394-7e853408f84c",
    rarity: "common",
    name: "Rapid Fire",
    oracleText:
        "Cast this spell only before blockers are declared.\nTarget creature gains first strike until end of turn. If it doesn't have rampage, that creature gains rampage 2 until end of turn. (Whenever the creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, W: 1 },
    types: ["Instant"],
    castPhaseRestriction: [
        "UPKEEP",
        "DRAW",
        "PRECOMBAT_MAIN",
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
    ],
    targetRequirement: { type: "Creature", count: 1 },
    // The granted rampage trigger lives here (off `triggeredAbilities`) so the
    // instant itself never fires it — only the creature it's granted to does.
    triggeredGrantTemplates: [rampageTrigger(2)],
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        // First strike until end of turn (CR 702.7, 611.2a).
        ctx.grantStaticAbility(target, "first strike", {
            phase: "end-of-turn",
        });
        // CR 702.23 — grant rampage 2 only if it has no rampage already.
        const hasRampage = ctx
            .getStaticAbilities(target)
            .some((a) => a.startsWith("rampage"));
        if (!hasRampage) {
            ctx.grantStaticAbility(target, "rampage 2", {
                phase: "end-of-turn",
            });
            ctx.grantTriggeredAbility(target, rapidFire.id, "rampage-2", {
                phase: "end-of-turn",
            });
        }
    },
};

// Divine Intervention — {6}{W}{W} Enchantment. Enters with two intervention
// counters; each upkeep removes one; when the last is removed, the game is a
// draw. CR 122 named counters, CR 104.4a game-draw via the new `ctx.drawGame()`
// primitive. The "when you remove the last counter" clause is folded into the
// upkeep resolve: removing the second counter ends the game in a draw.
export const divineIntervention: CardDefinition = {
    id: "9eae0ba1-1383-4505-b4e7-4f17dd8f20c5",
    rarity: "rare",
    name: "Divine Intervention",
    oracleText:
        "This enchantment enters with two intervention counters on it.\nAt the beginning of your upkeep, remove an intervention counter from this enchantment.\nWhen you remove the last intervention counter from this enchantment, the game is a draw.",
    manaCost: { X: 6, W: 2 },
    types: ["Enchantment"],
    entersWith: { counters: [{ type: "intervention", count: 2 }] },
    triggeredAbilities: [
        phaseTrigger({
            id: "divine-intervention-upkeep",
            oracleText:
                "At the beginning of your upkeep, remove an intervention counter from this enchantment. When you remove the last intervention counter from this enchantment, the game is a draw.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const removed = ctx.removeCounter(self, "intervention", 1);
                if (removed === 0) return;
                // CR 104.4a — the last counter just came off → the game draws.
                if (ctx.getCounterCount(self, "intervention") === 0) {
                    ctx.drawGame();
                }
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Global attack-restriction statics (#481, CR 508.1c)
//
// Moat and Akron Legionnaire forbid attacks by creatures OTHER than the source.
// Unlike the per-attacker `attack-restriction` static (which reads only the
// attacker's OWN definition, so a creature can restrict only itself), these use
// the `global-attack-restriction` kind: the engine scans EVERY permanent on the
// battlefield (`findGlobalAttackProhibition` in `combat.ts`) and asks each
// source's `forbids(attacker, source, state, ctx)` predicate whether it locks
// the candidate attacker — the symmetric analogue of how Crusade-style anthems
// (`pt-buff`) scan all permanents and buff a filtered set. Consumed by both
// `validateAttackerEligibility` (server declaration + the GRE) and the bot's
// attacker enumeration (`moves.ts`), which both already plumb `state`.
//
// `forbids` returns `true` when the attacker is BLOCKED (note the inverted
// polarity vs. `attack-restriction`, whose predicate returns `true` for LEGAL).
// ─────────────────────────────────────────────────────────────────────────────

// Moat — {2}{W}{W} Enchantment. "Creatures without flying can't attack."
// (CR 508.1c — a board-wide attack lock; flying is read from the attacker's
// effective `staticAbilities`, so a creature granted flying by an Aura attacks.)
export const moat: CardDefinition = {
    id: "952ba126-0915-47f0-9b6a-a0a6dcd22c6f",
    rarity: "rare",
    name: "Moat",
    oracleText: "Creatures without flying can't attack.",
    manaCost: { X: 2, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "global-attack-restriction",
            id: "moat-no-fly-no-attack",
            forbids: (attacker: PermanentView) => {
                const keywords =
                    (attacker as { staticAbilities?: string[] })
                        .staticAbilities ?? [];
                return !keywords.includes("flying");
            },
            oracleText: "Creatures without flying can't attack (Moat).",
        },
    ],
};

// Akron Legionnaire — {6}{W}{W} Creature — Giant Soldier, 8/4. "Except for
// creatures named Akron Legionnaire and artifact creatures, creatures you
// control can't attack." (CR 508.1c — the lock is scoped to the SOURCE's
// controller; Akron-named creatures and artifact creatures are exempt.)
export const akronLegionnaire: CardDefinition = {
    id: "5d074af2-8dbd-42d3-87eb-30f6e7d171ff",
    rarity: "rare",
    name: "Akron Legionnaire",
    oracleText:
        "Except for creatures named Akron Legionnaire and artifact creatures, creatures you control can't attack.",
    manaCost: { X: 6, W: 2 },
    types: ["Creature"],
    subtypes: ["Giant", "Soldier"],
    power: 8,
    toughness: 4,
    staticEffects: [
        {
            kind: "global-attack-restriction",
            id: "akron-allies-cant-attack",
            forbids: (
                attacker: PermanentView,
                source: PermanentView,
                _state,
                ctx: StaticEffectContext
            ) => {
                // Only creatures the SOURCE's controller controls are locked.
                if (attacker.controllerId !== source.controllerId) return false;
                // Exempt: creatures named Akron Legionnaire and artifact
                // creatures (which includes Akron's own copies / artifact bodies).
                if (ctx.getName(attacker) === "Akron Legionnaire") return false;
                // Live `types` (animate / type-add effects) when present, else
                // the printed type line — the client `CardInstance` may omit the
                // optional `types` array (CR 205.2).
                const types = attacker.types ?? ctx.getPrintedTypes(attacker);
                if (types.includes("Artifact")) return false;
                return true;
            },
            oracleText:
                "Except for creatures named Akron Legionnaire and artifact creatures, creatures you control can't attack (Akron Legionnaire).",
        },
    ],
};

// Petra Sphinx — {2}{W}{W}{W} 3/4 Sphinx (CR 202.3 name-a-card + CR 701.13
// reveal). "{T}: Target player chooses a card name, then reveals the top card
// of their library. If that card has the chosen name, that player puts it into
// their hand. If it doesn't, the player puts it into their graveyard." The
// targeted player is the chooser AND the controller of the consequence (a
// player may name a card to dig for their own top card). Composition: a
// `name-card` open choice (#489 `requestNameCard`) → `peekLibraryTop(1)` to
// read the top instance → `getCardName` to compare against the named card →
// `markKnownToAll` (CR 701.20 the card is revealed to all) → `moveCardById`
// library → hand on a match, library → graveyard on a mismatch.
export const petraSphinx: CardDefinition = {
    id: "5ef99f07-c987-451a-b18a-2719eea654cd",
    rarity: "rare",
    name: "Petra Sphinx",
    oracleText:
        "{T}: Target player chooses a card name, then reveals the top card of their library. If that card has the chosen name, that player puts it into their hand. If it doesn't, the player puts it into their graveyard.",
    manaCost: { X: 2, W: 3 },
    types: ["Creature"],
    subtypes: ["Sphinx"],
    power: 3,
    toughness: 4,
    activatedAbilities: [
        {
            id: "petra-sphinx-name-card",
            oracleText:
                "{T}: Target player chooses a card name, then reveals the top card of their library. If that card has the chosen name, that player puts it into their hand. If it doesn't, the player puts it into their graveyard.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045): `nameCard` (CR 201.3,
            // suspends for the open choice) → `digMatchingToHand` (CR 701.20a reveal
            // + 401.4 look/split, `look: 1`) reads the chosen name
            // back via a bare `ref` into `EffectCardFilter.name` — the exact
            // Desperate Research shape (inv/black.ts) narrowed to a single
            // card and a graveyard (not exile) miss destination.
            effects: [
                {
                    op: "nameCard",
                    player: { target: 0 },
                    prompt: "Name a card.",
                    bind: "$named",
                },
                {
                    op: "digMatchingToHand",
                    player: { target: 0 },
                    look: 1,
                    filter: { name: { ref: "$named" } },
                    destination: "graveyard",
                },
            ],
        },
    ],
};

// Clergy of the Holy Nimbus — "If this creature would be destroyed, regenerate
// it. {1}: This creature can't be regenerated this turn. Only your opponents
// may activate this ability." (CR 614.5, 701.19c, 602.1)
//
// The first ability is a CONTINUOUS auto-regeneration replacement, modeled as
// the `"auto-regenerate"` static ability keyword: `regenerateOrDestroy` reads
// the live `staticAbilities` and applies the regen rider (tap, heal damage,
// remove from combat) every time the creature would be destroyed, without
// consuming a shield. Being a keyword it is layer-6 grant/loss aware.
//
// The second ability is controller-locked via `activatableByOpponentsOnly`:
// only the controller's OPPONENTS may pay {1}, which sets the source's
// `cantBeRegeneratedThisTurn` flag (CR 701.19c) — suppressing the auto-regen
// so the next lethal destruction kills it. The flag clears at CLEANUP.
export const clergyOfTheHolyNimbus: CardDefinition = {
    id: "db1f578f-fa3b-4447-953b-1490852b6c80",
    rarity: "common",
    name: "Clergy of the Holy Nimbus",
    oracleText:
        "If this creature would be destroyed, regenerate it.\n{1}: This creature can't be regenerated this turn. Only your opponents may activate this ability.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    // CR 614.5 — continuous "if this would be destroyed, regenerate it"
    // replacement (perpetual, not a one-shot shield).
    staticAbilities: ["auto-regenerate"],
    activatedAbilities: [
        {
            id: "clergy-cant-regen",
            oracleText: "{1}: This creature can't be regenerated this turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            // CR 602.1 — controller may NOT activate; only opponents may.
            activatableByOpponentsOnly: true,
            effects: [
                { op: "preventRegeneration", target: { ref: "$source" } },
            ],
        },
    ],
};

// Wall of Caltrops — {1}{W} 2/1 Wall, Defender. "Whenever this creature blocks
// a creature, if at least one other Wall creature is blocking that creature and
// no non-Wall creatures are blocking that creature, this creature gains banding
// until end of turn." (CR 509.1h — block declaration; CR 603.4 intervening-if;
// CR 702.22 banding; CR 514.2 cleanup expiry.)
//
// COMPOSITION (no new primitive). The "blocks a creature" event is the per-pair
// BLOCKERS_CONFIRMED where Caltrops is the blocker (same source the Giant Shark
// / Venom block-time triggers read). The multi-Wall co-block condition is a
// classic intervening-if (CR 603.4), re-checked at resolution against the live
// block graph: among every creature blocking the SAME attacker there must be
// >=1 OTHER Wall and ZERO non-Wall blockers. On satisfaction we reuse the
// shipped duration-scoped keyword grant (`grantStaticAbility`, Berserk's
// trample precedent) to add the plain "banding" keyword EOT — the banding
// engine (`convex/gre/banding.ts`, CR 702.22j-k) then shifts combat-damage
// assignment via `getDamageAssignerId` exactly as for printed banding.
const WALL_OF_CALTROPS_ID = "664ad588-3002-4f63-93bd-38663171018f";

/** Ids of every creature currently blocking `attackerId` in the live block
 *  graph (CR 509.2). `blockerAssignments` maps blockerId → the attackers it is
 *  blocking, so we invert it. Not pruned when a blocker leaves the battlefield
 *  (CR 509.1h), but Caltrops is checked at block declaration where the graph is
 *  freshly recorded, so every listed blocker is live. */
function blockersOfAttacker(
    state: TriggerStateView | undefined,
    attackerId: string
): string[] {
    const assignments = state?.combat?.blockerAssignments;
    if (!assignments) return [];
    const out: string[] = [];
    for (const [blockerId, attackerIds] of Object.entries(assignments)) {
        if (attackerIds.includes(attackerId)) out.push(blockerId);
    }
    return out;
}

/** Subtypes of the permanent `id` across all battlefields, or undefined if it
 *  is no longer on the battlefield. */
function subtypesOf(
    state: TriggerStateView | undefined,
    id: string
): ReadonlyArray<string> | undefined {
    for (const player of state?.players ?? []) {
        const card = player.battlefield.find((c) => c.id === id);
        if (card) return card.subtypes;
    }
    return undefined;
}

/** The Wall of Caltrops grant condition (CR 603.4 intervening-if): among every
 *  creature blocking `attackerId`, at least one OTHER (≠ self) is a Wall and
 *  none of them is a non-Wall. Evaluated against the live block graph. */
function caltropsConditionHolds(
    self: PermanentView,
    attackerId: string,
    state: TriggerStateView | undefined
): boolean {
    const blockers = blockersOfAttacker(state, attackerId);
    let otherWalls = 0;
    let nonWalls = 0;
    for (const blockerId of blockers) {
        const subtypes = subtypesOf(state, blockerId);
        const isWall = subtypes?.includes("Wall") ?? false;
        if (!isWall) {
            nonWalls += 1;
            continue;
        }
        if (blockerId !== self.id) otherWalls += 1;
    }
    return otherWalls >= 1 && nonWalls === 0;
}

export const wallOfCaltrops: CardDefinition = {
    id: WALL_OF_CALTROPS_ID,
    rarity: "common",
    name: "Wall of Caltrops",
    oracleText:
        "Defender (This creature can't attack.)\nWhenever this creature blocks a creature, if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature, this creature gains banding until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 2,
    toughness: 1,
    staticAbilities: ["defender"],
    triggeredAbilities: [
        {
            id: "wall-of-caltrops-band",
            oracleText:
                "Whenever this creature blocks a creature, if at least one other Wall creature is blocking that creature and no non-Wall creatures are blocking that creature, this creature gains banding until end of turn.",
            event: "BLOCKERS_CONFIRMED",
            // Fire when Caltrops is the BLOCKER of the pair (CR 509.1h — "blocks
            // a creature"). One event per attacker it blocks; each is its own
            // block, so no per-pair dedupe is needed here.
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return event.blockerId === self.id;
            },
            // Intervening-if (CR 603.4): re-check the multi-Wall co-block at
            // resolution against the live block graph; fizzles if a non-Wall
            // joined or no other Wall is present.
            interveningIf: (event, self, state) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return caltropsConditionHolds(self, event.attackerId, state);
            },
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant banding
            // until end of turn (CR 702.22 / 514.2). The multi-Wall co-block
            // gate stays in `matches` / `interveningIf`; the effect body needs
            // no event fields (it grants to $source), so the effects site
            // applies. The banding engine handles combat-damage assignment.
            effects: [
                {
                    op: "grantAbility",
                    ability: "banding",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

// Greater Realm of Preservation — "{1}{W}: The next time a black or red source
// of your choice would deal damage to you this turn, prevent that damage."
// (CR 615.1, 615.6 — one-shot prevention shield scheduled against a chosen
// source; CR 202.2 — the choice is restricted to sources that are black OR red
// via `colorFilterAny`.) Built from the shared `makeCircleOfProtection` factory
// with the multi-color source variant and {1}{W} enchantment / activation costs.
export const greaterRealmOfPreservation: CardDefinition =
    makeCircleOfProtection({
        id: "5e236816-0c49-4b48-b18b-03add5a80d72",
        rarity: "uncommon",
        name: "Greater Realm of Preservation",
        oracleText:
            "{1}{W}: The next time a black or red source of your choice would deal damage to you this turn, prevent that damage.",
        source: { kind: "color-any", colors: ["B", "R"], word: "black or red" },
        manaCost: { X: 1, W: 1 },
        activationCost: { X: 1, W: 1 },
    });
