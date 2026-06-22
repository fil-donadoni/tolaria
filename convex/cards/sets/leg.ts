// Legends (LEG) — the game's first multicolor, "legendary matters" set (310
// unique cards). This file follows the established set-file pattern (ADR 0014):
// every in-scope card is either a new `CardDefinition` (Legends has no reprints
// of already-implemented cards, so it is effectively 100% new definitions) or,
// where it reprints an implemented card, a thin `CardPrint` stub. Modern
// Scryfall oracle text is authoritative (ADR 0004); canonical names / costs /
// P/T are sourced from MTGJSON `data/json/LEG.json`.
//
// THIS slice is the walking skeleton (#370): it registers the `leg` set and
// wires one thin end-to-end tracer — a pair of vanilla legendary creatures that
// carry the `Legendary` supertype as data and are playable from the card pool
// through a preset scenario. It proves the set file, the registry entry, the
// pool/deck availability, projection, and the test harness all work before the
// bulk free tranche and the 9 feature clusters land (see PRD #369).
//
// Generic mana is encoded as `X: n` (e.g. {3}{G}{W} → { X: 3, G: 1, W: 1 }).
//
// Out of scope for the whole set (per #369): Rebirth and Tempest Efreet (ante,
// ADR 0010). They stay absent so "Legends complete" means complete minus those
// two named exclusions. The remaining cards land in later batches.

import type {
    CardDefinition,
    ManaCost,
    SpellContext,
    PermanentView,
    StaticEffectContext,
    Color,
    GameEvent,
    TargetSelection,
} from "../types";
import { EFFECT_AFFECTS_SELF } from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { tappedTrigger } from "../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../abilities/triggers/damageDealtTrigger";
import { diedTrigger } from "../abilities/triggers/diedTrigger";
import { rampageTrigger } from "../abilities/triggers/rampageTrigger";
import { manaCostForCardId } from "../manaCostLookup";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla legendary creatures (CR 205.4a — Legendary supertype; CR 704.5j legend
// rule lands as an SBA in cluster C1, #369. A legendary vanilla creature is
// playable before that SBA ships and fully correct after — legendary-ness does
// not gate the card's release.)
// ─────────────────────────────────────────────────────────────────────────────

export const jasmineBoreal: CardDefinition = {
    id: "db6ef678-4ce9-48d6-aa4f-2afd9a1ad724",
    name: "Jasmine Boreal",
    oracleText: "",
    manaCost: { X: 3, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 4,
    toughness: 5,
};

export const ladyOrca: CardDefinition = {
    id: "b2779553-74eb-42ba-97d0-96269f48c269",
    name: "Lady Orca",
    oracleText: "",
    manaCost: { X: 5, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Demon"],
    power: 7,
    toughness: 4,
};

// ─────────────────────────────────────────────────────────────────────────────
// World enchantments (CR 205.4a — World supertype; CR 704.5m world rule lands
// as an SBA in cluster C2, #379). A World permanent carries the `World`
// supertype as data; the world-rule SBA (`checkWorldRuleSBA`) consumes the flag
// globally: when two or more World permanents exist, all but the newest go to
// their owners' graveyards (a simultaneous tie destroys all of them). These two
// carry no other new mechanic — their continuous effects ride the existing
// layer system (keyword grant / removal, CR 613.1a layer 6) — so they double as
// the real cards the world-rule SBA acts on.
// ─────────────────────────────────────────────────────────────────────────────

// Concordant Crossroads — World enchantment, "All creatures have haste."
// (CR 702.10, 613.1a layer 6 — keyword-grant to every creature, any controller.)
export const concordantCrossroads: CardDefinition = {
    id: "3bdcfae4-86c9-4d8a-bcfe-f0a928ec29db",
    name: "Concordant Crossroads",
    oracleText: "All creatures have haste.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    staticEffects: [
        {
            kind: "keyword-grant",
            // Global — every creature on the battlefield, regardless of
            // controller (CR 109.2 "all creatures").
            applies: (target: PermanentView) =>
                target.types.includes("Creature"),
            keyword: "haste",
        },
    ],
};

// Gravity Sphere — World enchantment, "All creatures lose flying."
// (CR 702.9, 613.1a layer 6 — keyword-remove on every creature, any controller.)
export const gravitySphere: CardDefinition = {
    id: "a2749332-e99a-4a0c-b3a3-5578b552fa11",
    name: "Gravity Sphere",
    oracleText: "All creatures lose flying.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    staticEffects: [
        {
            kind: "keyword-remove",
            applies: (target: PermanentView) =>
                target.types.includes("Creature"),
            keyword: "flying",
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
    name: "Wall of Light",
    oracleText: "Defender (This creature can't attack.)\nProtection from black",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender", "protection from black"],
};

// Righteous Avengers — plainswalk (CR 702.19 landwalk variant).
export const righteousAvengers: CardDefinition = {
    id: "d96b463e-9579-4e7b-87c2-342527b91e7c",
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

// Great Wall — global plainswalk negation (CR 509.1b / 702.13). The
// `landwalk-negation` static is scanned across the defending player's
// battlefield by the keyword-evasion pass (`combatRegistry.ts`): a creature
// with plainswalk can then be blocked as though it didn't have it, regardless
// of the defender's Plains. Parametric `subtypes` shares one kind with
// Undertow (Island) and the LEG suppression statics (Gosta Dirk et al.).
export const greatWall: CardDefinition = {
    id: "cd860a1d-aa17-4579-b9b1-d101d2416387",
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
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.dealDamage(target, 1);
            },
        },
    ],
};

// --- Block / evasion restriction creatures (CR 509.1b) --------------------

// Amrou Kithkin — can't be blocked by power 3 or greater (CR 509.1b). The
// block-restriction predicate receives the candidate blocker enriched to
// effective power (post-layer-7c) by the combat validator.
export const amrouKithkin: CardDefinition = {
    id: "cbce1c55-123c-4a05-bde4-18a1601fcc5a",
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
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};

// --- Sweepers / removal spells (CR 701.7) ----------------------------------

// Cleanse — "Destroy all black creatures." (CR 701.7 mass destroy filtered on
// colour, CR 202.2.)
export const cleanse: CardDefinition = {
    id: "2fbd611b-ac97-4516-bad7-cc9ee4ef74f7",
    name: "Cleanse",
    oracleText: "Destroy all black creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        // `getBattlefieldIds` derives colours (CR 202.2) from the card
        // registry; `destroyAll`'s filter does not populate `colors`, so the
        // sweep is driven by the colour-aware id query instead.
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                colors: "B",
            })) {
                ctx.destroy({ type: "permanent", id });
            }
        }
    },
};

// Divine Offering — "Destroy target artifact. You gain life equal to its mana
// value." (CR 701.7 + 118.3 lifegain; snapshot the MV before the destroy.)
export const divineOffering: CardDefinition = {
    id: "9c78c2f3-2f40-48ad-9dc4-55d1fa399a56",
    name: "Divine Offering",
    oracleText:
        "Destroy target artifact. You gain life equal to its mana value.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Artifact", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const mv = ctx.getManaValue(target);
        ctx.destroy(target);
        ctx.gainLife(ctx.caster, mv);
    },
};

// --- Pump spells (CR 611.1, end-of-turn duration) --------------------------

// Great Defender — "Target creature gets +0/+X until end of turn, where X is
// its mana value." (CR 202.3 mana value snapshot + 611.1 temporary buff.)
export const greatDefender: CardDefinition = {
    id: "879a8653-1538-4f78-a3d3-a900a4d9499b",
    name: "Great Defender",
    oracleText:
        "Target creature gets +0/+X until end of turn, where X is its mana value.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
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
    name: "Shield Wall",
    oracleText: "Creatures you control get +0/+2 until end of turn.",
    manaCost: { X: 1, W: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        for (const id of ctx.getBattlefieldIds(ctx.caster, {
            types: "Creature",
        })) {
            ctx.addTemporaryPTBuff({ type: "permanent", id }, 0, 2, {
                phase: "end-of-turn",
            });
        }
    },
};

// --- Damage prevention (CR 615) --------------------------------------------

// Holy Day — "Prevent all combat damage that would be dealt this turn."
// (CR 615 — the global combat-damage prevention used by Fog-style cards.)
export const holyDay: CardDefinition = {
    id: "f6c95a2b-bf44-4ff2-9c6a-916773346edd",
    name: "Holy Day",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.preventAllCombatDamage();
    },
};

// Indestructible Aura — "Prevent all damage that would be dealt to target
// creature this turn." (CR 615 — a per-target shield. "All damage" is modeled
// as a very large prevention amount consumed across the turn.)
export const indestructibleAura: CardDefinition = {
    id: "ed2a7333-c9ce-4011-b00e-1304e1eec25e",
    name: "Indestructible Aura",
    oracleText:
        "Prevent all damage that would be dealt to target creature this turn.",
    manaCost: { W: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        // No "prevent all damage to target" primitive exists; a shield large
        // enough to absorb any realistic turn's damage gives the same outcome
        // (CR 615.1, consumed per damage event, purged at end of turn).
        ctx.preventNextNDamageToTarget(target, 9999, { phase: "end-of-turn" });
    },
};

// Alabaster Potion — modal: "Target player gains X life" OR "Prevent the next X
// damage that would be dealt to any target this turn." (CR 700.2 modal spell.)
export const alabasterPotion: CardDefinition = {
    id: "2806c7f6-8fdd-4e65-9c71-f2e8b0cdede2",
    name: "Alabaster Potion",
    oracleText:
        "Choose one —\n• Target player gains X life.\n• Prevent the next X damage that would be dealt to any target this turn.",
    manaCost: { X: "X", W: 2 },
    types: ["Instant"],
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
// player controls a Plains, they gain 1 life." (CR 603.6a + 603.4d if-clause.)
export const spiritualSanctuary: CardDefinition = {
    id: "654dd1e0-a91d-44ee-af20-c025bf360c3f",
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
            resolve: (ctx, _event, scopedPlayerId) => {
                ctx.gainLife(scopedPlayerId, 1);
            },
        }),
    ],
};

// Lifeblood — "Whenever a Mountain an opponent controls becomes tapped, you
// gain 1 life." (CR 701.20a tap trigger, scoped to opponents' Mountains.)
export const lifeblood: CardDefinition = {
    id: "4ecb1362-9a67-4d4c-8d69-9ac2ebf4d0b0",
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
            resolve: (ctx) => {
                ctx.gainLife(ctx.controller, 1);
            },
        }),
    ],
};

// Presence of the Master — "Whenever a player casts an enchantment spell,
// counter it." (CR 601.2i cast trigger → CR 701.5a counter.)
export const presenceOfTheMaster: CardDefinition = {
    id: "1cb86b2f-116d-4952-b35a-1398341baaf5",
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
            resolve: (ctx, _event, spell) => {
                ctx.counter({ type: "spell", id: spell.instanceId });
            },
        }),
    ],
};

// --- Library inspection (CR 401) -------------------------------------------

// Visions — "Look at the top five cards of target player's library. You may
// then have that player shuffle that library." (CR 401.4 look → markKnown to
// the caster; optional shuffle, CR 701.20.)
export const visions: CardDefinition = {
    id: "21d00299-e183-4b3d-b015-18808e7135b9",
    name: "Visions",
    oracleText:
        "Look at the top five cards of target player's library. You may then have that player shuffle that library.",
    manaCost: { W: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
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

// ─────────────────────────────────────────────────────────────────────────────
// Blue free tranche (#372) — every mono-blue Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, prevention shields, SpellContext methods). Data + resolve()
// closures only; zero engine change (ADR 0014).
//
// EXCLUDED from this batch (owned by #369 feature clusters, or needing an
// unbuilt primitive — left for their owning issue):
//   • C5 named counters — Glyph of Delusion (glyph counters), Venarian Gold
//     (sleep counters).
//   • C6 shroud / can't-be-targeted — SHIPPED below (Spectral Cloak,
//     Anti-Magic Aura, Bartel Runeaxe). Tetsuo Umezawa and Wall of Shadows are
//     deferred — see the C6 section footer for the per-card reasons.
//   • C7 upkeep pay-or-sacrifice — Elder Spawn ("unless you sacrifice an
//     Island, sacrifice this and it deals 6 damage to you").
//   • C8 cast-tax counter-unless-pay — Nether Void and In the Eye of Chaos
//     (both World) SHIPPED in the C8 section at the foot of this file (#385).
//     Invoke Prejudice (counter an opponent's off-color creature spell unless
//     they pay its mana value) is the same cast-tax family but adds an off-color
//     spell filter; it stays deferred to keep #385 scoped to the two World
//     enchantments.
//   • World rule (C2) / no continuous-reveal static — Field of Dreams ("play
//     with the top card of libraries revealed": needs a continuous top-of-
//     library reveal static that does not exist yet).
//   • No primitive yet (flagged for a future batch):
//     - Juxtapose — exchange control of the greatest-MV creature/artifact
//       (no control-exchange primitive).
//     - Land Equilibrium — opponent land-drop replacement gated on land counts
//       (no land-ETB replacement primitive).
//     - Enchantment Alteration — move an Aura to another permanent (no Aura
//       re-attach primitive).
//     - Puppet Master — dies-return-to-hand + optional buy-back of the Aura.
//     - Relic Bind — modal tap-trigger on an opponent's artifact.
//     - Time Elemental — attacks/blocks → end-of-combat self-sacrifice + 5
//       damage, plus a bounce activated ability (doable, deferred to keep this
//       batch low-risk).
//     - Brine Hag — set base P/T of every creature that damaged it this turn
//       (no per-instance "damaged me this turn" tally surfaced).
//     - Reverberation — redirect a target sorcery's damage to its controller.
//     - Silhouette — prevent damage from sources that TARGET a chosen creature.
//     - Telekinesis — tap + prevent its combat damage + skip its next two untap
//       steps (no multi-step untap-skip primitive).
//     - Dream Coat — "{0}: enchanted creature becomes the color or colors of
//       your choice" (multi-color free-choice primitive).
//     - Psychic Purge — its punisher half is a from-hand discard trigger (no
//       discard-from-hand trigger); shipping only the damage half would be
//       partial.
//     - Wall of Vapor — prevent damage to it from creatures it's blocking (no
//       blocking-pair-scoped prevention).
//     - Gaseous Form — "Prevent all combat damage to and dealt by enchanted
//       creature" is a CONTINUOUS aura prevention; only a turn-scoped combat
//       shield exists, no "for as long as enchanted" prevention static.
// ─────────────────────────────────────────────────────────────────────────────

// Recall — "Discard X cards, then return a card from your graveyard to your
// hand for each card discarded this way. Exile Recall." (CR 107.3 X chosen on
// cast; CR 701.8 discard; CR 400.7 graveyard→hand; CR 608.2 self-exile.)
//
// Cost is {X}{X}{U}: the player pays twice the chosen X (`xFactor: 2`) but the
// DISCARD COUNT equals the announced X (`getX()`), not the paid generic.
//
// Two resolveSteps so the discard and the return are isolated suspension
// points (CR 608.2 stepped resolution):
//   • Step 0 — discard X chosen cards from hand (clamped to hand size). The
//     discarded cards land in the graveyard BEFORE the return step, so they
//     are themselves valid return targets — the classic Recall loop.
//   • Step 1 — return up to (number actually discarded) chosen cards from the
//     graveyard to hand. The discarded count is read back across steps via
//     `recallChoice`. Then Recall exiles itself (CR 608.2).
// X = 0 discards nothing, returns nothing, and still exiles. A graveyard with
// fewer cards than the discard count caps the return at what's available.
export const recall: CardDefinition = {
    id: "33296718-0625-4422-a65c-b21cf99c52ec",
    name: "Recall",
    oracleText:
        "Discard X cards, then return a card from your graveyard to your hand for each card discarded this way. Exile Recall.",
    manaCost: { X: "X", xFactor: 2, U: 1 },
    types: ["Sorcery"],
    resolveSteps: [
        // Step 0 — discard X chosen cards (CR 701.8). Clamp to hand size so a
        // chosen X above hand count discards everything held without stalling.
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const x = ctx.getX();
            const max = Math.min(x, ctx.getHandSize(me));
            if (max <= 0) return; // X = 0 or empty hand — nothing to discard.
            const picks = ctx.requestChoice({
                playerId: me,
                choiceId: "recall-discard",
                kind: "discard-hand",
                zone: "hand",
                count: max,
                prompt: `Recall: discard ${max} ${max === 1 ? "card" : "cards"}.`,
            });
            if (picks === undefined) return; // suspended for the discard pick
            for (const id of picks) ctx.discardCard(me, id);
        },
        // Step 1 — return up to (cards actually discarded) cards from the
        // graveyard to hand (CR 400.7), then exile Recall (CR 608.2). The
        // discarded ids are read back across the step boundary; the just-
        // discarded cards are in the graveyard now, so they're valid targets.
        (ctx: SpellContext) => {
            const me = ctx.controller;
            const discarded = ctx.recallChoice("recall-discard")?.length ?? 0;
            const graveyardIds = ctx.getGraveyardCards(me).map((c) => c.id);
            const max = Math.min(discarded, graveyardIds.length);
            if (max > 0) {
                const picks = ctx.requestChoice({
                    playerId: me,
                    choiceId: "recall-return",
                    kind: "choose-graveyard-card",
                    zone: "graveyard",
                    candidateIds: graveyardIds,
                    count: { min: 0, max },
                    prompt: `Recall: return up to ${max} ${max === 1 ? "card" : "cards"} from your graveyard to your hand.`,
                });
                if (picks === undefined) return; // suspended for the return pick
                for (const id of picks) {
                    ctx.moveCardById(me, id, "graveyard", "hand");
                }
            }
            // CR 608.2 — "Exile Recall." Last instruction in the spell.
            ctx.exileSelf();
        },
    ],
};

// --- Vanilla / keyword creatures (CR 702 — pure data) ---------------------

// Azure Drake — flying (CR 702.9).
export const azureDrake: CardDefinition = {
    id: "fb5f13a2-0896-4230-8957-6ad1cb2b895b",
    name: "Azure Drake",
    oracleText: "Flying",
    manaCost: { X: 3, U: 1 },
    types: ["Creature"],
    subtypes: ["Drake"],
    power: 2,
    toughness: 4,
    staticAbilities: ["flying"],
};

// Zephyr Falcon — flying, vigilance (CR 702.9, 702.21).
export const zephyrFalcon: CardDefinition = {
    id: "25a173fd-e10c-45f8-a6e5-ad7a747a8050",
    name: "Zephyr Falcon",
    oracleText: "Flying, vigilance",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Bird"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying", "vigilance"],
};

// Undertow — global islandwalk negation (CR 509.1b / 702.13). Twin of Great
// Wall via the shared parametric `landwalk-negation` static, differing only in
// the negated subtype (Island). Creatures with islandwalk can be blocked as
// though they didn't have it, regardless of the defender's Islands.
export const undertow: CardDefinition = {
    id: "cf05e5c9-b7e4-4bd8-ab73-b54565710527",
    name: "Undertow",
    oracleText:
        "Creatures with islandwalk can be blocked as though they didn't have islandwalk.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "landwalk-negation",
            id: "undertow-islandwalk-negation",
            subtypes: ["Island"],
            oracleText:
                "Creatures with islandwalk can be blocked as though they didn't have islandwalk.",
        },
    ],
};

// Devouring Deep — islandwalk (CR 702.19 landwalk variant).
export const devouringDeep: CardDefinition = {
    id: "0855a5a8-8c40-4396-9ad1-8fa0fc6a0c59",
    name: "Devouring Deep",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Fish"],
    power: 1,
    toughness: 2,
    staticAbilities: ["islandwalk"],
};

// Segovian Leviathan — islandwalk (CR 702.19).
export const segovianLeviathan: CardDefinition = {
    id: "e5a814f1-7f8d-4c2c-b706-ee0ed5892f7b",
    name: "Segovian Leviathan",
    oracleText:
        "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Leviathan"],
    power: 3,
    toughness: 3,
    staticAbilities: ["islandwalk"],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Psionic Entity — "{T}: This creature deals 2 damage to any target and 3
// damage to itself." (CR 120.1 / 115.4 — self-damage is a normal damage event
// to the source permanent.)
export const psionicEntity: CardDefinition = {
    id: "ec082062-5394-4340-bc29-0efd2af4b822",
    name: "Psionic Entity",
    oracleText:
        "{T}: This creature deals 2 damage to any target and 3 damage to itself.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Illusion"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "psionic-entity-zap",
            oracleText:
                "{T}: This creature deals 2 damage to any target and 3 damage to itself.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 2);
                ctx.dealDamage(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    3
                );
            },
        },
    ],
};

// Wall of Wonder — Defender; "{2}{U}{U}: This creature gets +4/-4 until end of
// turn and can attack this turn as though it didn't have defender." (CR 702.3
// defender + 611.1 temporary P/T + a temporary attack-enable via the can-attack
// grant.) Modeled by granting the keyword `can-attack-with-defender` for the
// turn — combat eligibility honours it the same way Wall of Wonder's text
// suspends defender.
export const wallOfWonder: CardDefinition = {
    id: "bcd9af40-b46c-44b4-878e-8eb026c96b51",
    name: "Wall of Wonder",
    oracleText:
        "Defender (This creature can't attack.)\n{2}{U}{U}: This creature gets +4/-4 until end of turn and can attack this turn as though it didn't have defender.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 1,
    toughness: 5,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-wonder-animate",
            oracleText:
                "{2}{U}{U}: This creature gets +4/-4 until end of turn and can attack this turn as though it didn't have defender.",
            cost: { mana: { X: 2, U: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.addTemporaryPTBuff(self, 4, -4, { phase: "end-of-turn" });
                // "can attack as though it didn't have defender" — grant the
                // attack-enable keyword the combat validator checks for
                // defender suspension (CR 508.1a).
                ctx.grantStaticAbility(self, "can-attack-with-defender", {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// --- Auras (CR 303 — Enchant creature) ------------------------------------

// Backfire — "Whenever enchanted creature deals damage to you, this Aura deals
// that much damage to that creature's controller." (CR 303.4 host trigger →
// CR 120.1 damage.)
export const backfire: CardDefinition = {
    id: "04bc57aa-d4d9-4bd9-ba09-984370c7e23b",
    name: "Backfire",
    oracleText:
        "Enchant creature\nWhenever enchanted creature deals damage to you, this Aura deals that much damage to that creature's controller.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        damageDealtTrigger({
            id: "backfire-reflect",
            oracleText:
                "Whenever enchanted creature deals damage to you, this Aura deals that much damage to that creature's controller.",
            source: "any",
            // Fire only when the damage source is the host AND the damage was
            // dealt to the aura's controller (CR 303.4b "to you").
            condition: (event, self) =>
                event.sourceInstanceId === self.attachedTo &&
                event.target.type === "player" &&
                event.target.id === self.controllerId,
            resolve: (ctx, event) => {
                const host = ctx.getAttachedToId();
                if (!host) return;
                const hostController = ctx.getController({
                    type: "permanent",
                    id: host,
                });
                ctx.dealDamage(
                    { type: "player", id: hostController },
                    event.amount
                );
            },
        }),
    ],
};

// --- Counterspells (CR 701.5a) ---------------------------------------------

// Mana Drain — "Counter target spell. At the beginning of your next main phase,
// add an amount of {C} equal to that spell's mana value." (CR 701.5a counter +
// CR 603.7 / 505 next-main-phase delayed trigger + CR 107.4c {C} colorless mana.)
// The countered spell's mana value (CR 202.3, including any chosen X via
// `getManaValue`) is snapshotted at resolution and carried on the delayed
// trigger's payload; the {C} is added to the caster's pool when their next main
// phase begins.
export const manaDrain: CardDefinition = {
    id: "e691adef-3027-4e6a-889f-9f4e2df36a7c",
    name: "Mana Drain",
    oracleText:
        "Counter target spell. At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.",
    manaCost: { U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "spell") return;
        // Snapshot the spell's mana value before countering it (CR 202.3 /
        // 603.10 last-known information) — once countered it leaves the stack.
        const mv = ctx.getManaValue(target);
        ctx.counter(target);
        // CR 603.7 — schedule the {C} payoff for the caster's next main phase.
        // `targetPlayerId` gates firing to the caster's own main phase (CR 505).
        ctx.scheduleDelayedTrigger(
            manaDrain.id,
            "mana-drain-add",
            "next-main-phase",
            { controller: ctx.caster, mv: String(mv) },
            ctx.caster
        );
    },
    delayedTriggers: [
        {
            id: "mana-drain-add",
            oracleText:
                "At the beginning of your next main phase, add an amount of {C} equal to that spell's mana value.",
            timing: "next-main-phase",
            resolve: (ctx, payload) => {
                const mv = Number(payload.mv ?? "0");
                const controller = payload.controller;
                if (mv > 0 && controller) {
                    // CR 107.4c — {C} is colorless mana, added to the pool.
                    ctx.addManaTo(controller, { C: mv });
                }
            },
        },
    ],
};

// Flash Counter — "Counter target instant spell." (CR 701.5a + spellTypeFilter
// for the instant-only restriction, CR 114.1.)
export const flashCounter: CardDefinition = {
    id: "3c3cd450-f1cd-416b-9271-37d95815c089",
    name: "Flash Counter",
    oracleText: "Counter target instant spell.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Instant",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "spell") ctx.counter(target);
    },
};

// Remove Soul — "Counter target creature spell." (CR 701.5a, CR 114.1.)
export const removeSoul: CardDefinition = {
    id: "63de147c-2e62-41b9-8ada-93406387f08b",
    name: "Remove Soul",
    oracleText: "Counter target creature spell.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellTypeFilter: "Creature",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "spell") ctx.counter(target);
    },
};

// Force Spike — "Counter target spell unless its controller pays {1}."
// (CR 701.5a counter-unless-pay, CR 117.3a may-pay against the spell's
// controller.)
export const forceSpike: CardDefinition = {
    id: "70e64028-ae96-4950-aa6c-9d347409fad3",
    name: "Force Spike",
    oracleText: "Counter target spell unless its controller pays {1}.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "spell") return;
        const spellController = ctx.getController(target);
        const paid = ctx.requestMayPay({
            playerId: spellController,
            choiceId: "force-spike-pay",
            cost: { X: 1 },
            prompt: "Pay {1} to prevent your spell from being countered?",
        });
        if (paid === undefined) return; // suspended on the may-pay choice
        if (!paid) ctx.counter(target);
    },
};

// --- Bounce / removal spells -----------------------------------------------

// Boomerang — "Return target permanent to its owner's hand." (CR 701.10.)
export const boomerang: CardDefinition = {
    id: "b8286edd-644b-4135-8dca-af97f3920de3",
    name: "Boomerang",
    oracleText: "Return target permanent to its owner's hand.",
    manaCost: { U: 2 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent") ctx.returnToHand(target);
    },
};

// Acid Rain — "Destroy all Forests." (CR 701.7 mass destroy filtered on the
// Forest land subtype, CR 205.3.)
export const acidRain: CardDefinition = {
    id: "ba93c50a-2440-4e92-9cba-d97e20b1d29c",
    name: "Acid Rain",
    oracleText: "Destroy all Forests.",
    manaCost: { X: 3, U: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        ctx.destroyAll({ subtypes: "Forest" });
    },
};

// Flash Flood — modal: "Destroy target red permanent." OR "Return target
// Mountain to its owner's hand." (CR 700.2 modal spell.)
export const flashFlood: CardDefinition = {
    id: "5ae88c06-f28c-4fbc-a28c-5eb203a04722",
    name: "Flash Flood",
    oracleText:
        "Choose one —\n• Destroy target red permanent.\n• Return target Mountain to its owner's hand.",
    manaCost: { U: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "destroy-red",
            label: "Destroy target red permanent",
            oracleText: "Destroy target red permanent.",
            targetRequirement: { type: "any", count: 1, colorFilter: "R" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
        {
            id: "return-mountain",
            label: "Return target Mountain to its owner's hand",
            oracleText: "Return target Mountain to its owner's hand.",
            targetRequirement: {
                type: "Land",
                count: 1,
                subtypeFilter: "Mountain",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.returnToHand(target);
            },
        },
    ],
};

// --- Evasion / pump spells (CR 611.1, end-of-turn duration) ----------------

// Sea Kings' Blessing — "One or more target creatures become blue until end of
// turn." (CR 305.7 layer 5 colour override, end-of-turn duration; "one or
// more" = a variable-count target requirement, CR 601.2c.)
export const seaKingsBlessing: CardDefinition = {
    id: "11d1f02d-533e-4b77-a72a-ff5f91ae0626",
    name: "Sea Kings' Blessing",
    oracleText: "One or more target creatures become blue until end of turn.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.setColorOverride(target, ["U"]);
            }
        }
    },
};

// Part Water — "X target creatures gain islandwalk until end of turn."
// (CR 107.3 X count + 702.19 keyword grant, end-of-turn duration.)
export const partWater: CardDefinition = {
    id: "4b659475-c8b7-493d-af63-04f34d8cc3b1",
    name: "Part Water",
    oracleText:
        "X target creatures gain islandwalk until end of turn. (They can't be blocked as long as defending player controls an Island.)",
    manaCost: { X: "X", U: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: "X" },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.grantStaticAbility(target, "islandwalk", {
                    phase: "end-of-turn",
                });
            }
        }
    },
};

// Teleport — "Target creature can't be blocked this turn." Cast only during
// the declare attackers step (CR 117.1b cast-phase restriction; CR 509.1b
// can't-be-blocked on the attacker side).
export const teleport: CardDefinition = {
    id: "18f86e13-f942-423e-b175-930d768cb811",
    name: "Teleport",
    oracleText:
        "Cast this spell only during the declare attackers step.\nTarget creature can't be blocked this turn.",
    manaCost: { U: 3 },
    types: ["Instant"],
    castPhaseRestriction: ["DECLARE_ATTACKERS"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type === "permanent") {
            ctx.setCantBeBlockedThisTurn(target);
        }
    },
};

// --- Mana / untap utility --------------------------------------------------

// Energy Tap — "Tap target untapped creature you control. If you do, add an
// amount of {C} equal to that creature's mana value." (CR 701.20a tap +
// CR 106.1 mana, snapshotting the MV before the tap.)
export const energyTap: CardDefinition = {
    id: "37e69940-bdc8-48ff-a296-540343910adf",
    name: "Energy Tap",
    oracleText:
        "Tap target untapped creature you control. If you do, add an amount of {C} equal to that creature's mana value.",
    manaCost: { U: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        controller: "you",
        tappedFilter: "untapped",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const mv = ctx.getManaValue(target);
        ctx.tap(target);
        if (mv > 0) ctx.addManaTo(ctx.caster, { C: mv });
    },
};

// Reset — "Untap all lands you control." Cast only during an opponent's turn
// after their upkeep step (CR 117.1b — opponent-turn restriction; the
// post-upkeep window is approximated by excluding the opponent's UPKEEP).
export const reset: CardDefinition = {
    id: "1c829d83-d5b8-4be7-80f7-55b42f52b309",
    name: "Reset",
    oracleText:
        "Cast this spell only during an opponent's turn after their upkeep step.\nUntap all lands you control.",
    manaCost: { U: 2 },
    types: ["Instant"],
    castTurnRestriction: "opponent",
    castPhaseRestriction: [
        "DRAW",
        "PRECOMBAT_MAIN",
        "BEGINNING_OF_COMBAT",
        "DECLARE_ATTACKERS",
        "DECLARE_BLOCKERS",
        "FIRST_STRIKE_DAMAGE",
        "COMBAT_DAMAGE",
        "END_OF_COMBAT",
        "POSTCOMBAT_MAIN",
        "END_STEP",
    ],
    resolve: (ctx: SpellContext) => {
        for (const id of ctx.getBattlefieldIds(ctx.caster, { types: "Land" })) {
            ctx.untap({ type: "permanent", id });
        }
    },
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

// ─────────────────────────────────────────────────────────────────────────────
// Black free tranche (#373) — every mono-black Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, regeneration shields, prevention shields, reanimation, SpellContext
// methods). Data + resolve() closures only; zero engine change (ADR 0014).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • Nether Void → C8 (cast-tax "counter unless pay" World enchantment).
//   • Cosmic Horror, Mold Demon → C7 (upkeep / ETB pay-or-sacrifice).
//   • Spirit Shackle, Takklemaggot, All Hallow's Eve → C5 (named counters:
//     -0/-2, -0/-1, scream).
//   • Wall of Shadows → C6 (can't-be-the-target-of Wall-only spells/abilities).
//   • Pit Scorpion → C5 (poison counters — no named-counter primitive yet).
//   • Lesser Werewolf → C5 (-0/-1 counters on a combatant).
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here):
//   • Transmutation — "switch power and toughness" has no swap primitive.
//   • Abomination, Infernal Medusa — "whenever this blocks / becomes blocked by
//     [a creature], destroy that creature at end of combat" needs a
//     becomes-blocked trigger plus a deferred end-of-combat destroy; neither
//     exists.
//   • Glyph of Doom — "at the next end of combat, destroy all creatures blocked
//     by that Wall this turn" needs the same deferred-end-of-combat + per-combat
//     block tracking.
//   • Imprison — counters a {T} activation of the enchanted creature and removes
//     it from combat for {1}; no activate-an-ability "may pay to counter"
//     replacement.
//   • Chains of Mephistopheles — a draw replacement with a per-step exemption;
//     no draw-replacement primitive of this shape.
//   • Giant Slug — "{5}: at the beginning of your next upkeep, gain landwalk
//     of a chosen type" needs a delayed cross-turn keyword grant.
//   • Shimian Night Stalker — continuous combat-damage redirection from a chosen
//     attacker; no such redirection primitive.
//   • Underworld Dreams — "whenever an opponent draws a card" needs a card-drawn
//     trigger that doesn't exist yet.
//   • Vampire Bats — "{B}: +1/+0, activate no more than TWICE each turn" needs a
//     numeric per-turn activation cap (only `oncePerTurn` exists).
//   • Quagmire — "creatures with swampwalk can be blocked as though they didn't
//     have swampwalk" — buildable with the `landwalk-negation` static (Great
//     Wall / Undertow, #484), `subtypes: ["Swamp"]`. Deferred to its tranche.
//   • Demonic Torment, Evil Eye of Orms-by-Gore — emit can't-attack restrictions
//     onto OTHER creatures. UNBLOCKED by the `global-attack-restriction` static
//     shipped with Moat / Akron Legionnaire (#481): a battlefield-scanned
//     `forbids(attacker, source, state, ctx)` predicate can now lock attacks by
//     creatures other than the source. (These two cards remain unimplemented
//     for unrelated reasons — Demonic Torment is an Aura whose lock is scoped to
//     its host, Evil Eye gates on its own untapped/blocked state — but the
//     other-creature attack-lock primitive they were waiting on now exists.)
//   • Wall of Putrid Flesh — its "prevent all damage dealt to this by enchanted
//     creatures" clause needs a continuous, source-filtered prevention static.
// ─────────────────────────────────────────────────────────────────────────────

// --- World enchantments with an upkeep trigger (CR 205.4a / 704.5m) --------

// The Abyss — {3}{B} World Enchantment. "At the beginning of each player's
// upkeep, destroy target nonartifact creature that player controls of their
// choice. It can't be regenerated." (CR 603.6a each-player upkeep trigger.)
//
// The World supertype + its SBA shipped in C2 (#379); the world rule needs no
// per-card wiring. The destroy is modelled as an active-player CHOICE rather
// than the standard ability-controller target: the Oracle's "that player ...
// of their choice" names the upkeep's active player as the chooser (overriding
// the CR 603.3d default that the ability's controller picks targets), and the
// legal pool is that player's own nonartifact creatures. `requestChoice` with
// `playerId`/`zoneOwnerId` = the scoped (active) player expresses exactly that
// — no targeted-trigger machinery (which would default the chooser to The
// Abyss's controller) is needed. If the active player controls no nonartifact
// creature the ability does nothing (CR 603.2c — no legal choice).
export const theAbyss: CardDefinition = {
    id: "86a27d68-3e58-4ade-976d-36381beed451",
    name: "The Abyss",
    oracleText:
        "At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice. It can't be regenerated.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    triggeredAbilities: [
        phaseTrigger({
            id: "the-abyss-upkeep-destroy",
            oracleText:
                "At the beginning of each player's upkeep, destroy target nonartifact creature that player controls of their choice. It can't be regenerated.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                // CR 603.2c — only the active player's nonartifact creatures
                // are legal; with none, the ability resolves doing nothing.
                const candidates = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Creature",
                    excludeTypes: "Artifact",
                });
                if (candidates.length === 0) return;
                // The active player chooses which of their nonartifact
                // creatures dies ("of their choice").
                const chosen = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: "the-abyss-destroy",
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    zoneOwnerId: scopedPlayerId,
                    filter: { types: "Creature", excludeTypes: "Artifact" },
                    count: 1,
                    prompt: "Choose a nonartifact creature you control to destroy (The Abyss).",
                });
                if (chosen === undefined) return; // suspended on the choice
                const id = chosen[0];
                if (!id) return;
                // CR 701.7c — "It can't be regenerated."
                ctx.destroy(
                    { type: "permanent", id },
                    { cantBeRegenerated: true }
                );
            },
        }),
    ],
};

// --- Vanilla / keyword creatures (CR 702 — pure data) ---------------------

// Headless Horseman — vanilla 2/2 (CR 110.1 pure data).
export const headlessHorseman: CardDefinition = {
    id: "d1aa37c8-98fa-4984-b09b-cf65ad84e97b",
    name: "Headless Horseman",
    oracleText: "",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie", "Knight"],
    power: 2,
    toughness: 2,
};

// Lost Soul — swampwalk (CR 702.19 landwalk variant).
export const lostSoul: CardDefinition = {
    id: "601eed5c-436d-425b-a45f-07881ad893c8",
    name: "Lost Soul",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit", "Minion"],
    power: 2,
    toughness: 1,
    staticAbilities: ["swampwalk"],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Carrion Ants — "{1}: This creature gets +1/+1 until end of turn." (CR 611.1
// repeatable temporary buff.)
export const carrionAnts: CardDefinition = {
    id: "cbc0b009-3951-4aa3-985a-97139882da7e",
    name: "Carrion Ants",
    oracleText: "{1}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 0,
    toughness: 1,
    activatedAbilities: [
        {
            id: "carrion-ants-pump",
            oracleText: "{1}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Walking Dead — "{B}: Regenerate this creature." (CR 701.15a regeneration
// shield.)
export const walkingDead: CardDefinition = {
    id: "d7533a72-77d1-40cd-b3a1-7597d566c428",
    name: "Walking Dead",
    oracleText: "{B}: Regenerate this creature.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "walking-dead-regenerate",
            oracleText: "{B}: Regenerate this creature.",
            cost: { mana: { B: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.applyRegenerationShield({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
    ],
};

// Ghosts of the Damned — "{T}: Target creature gets -1/-0 until end of turn."
// (CR 611.1 temporary debuff via a tap ability.)
export const ghostsOfTheDamned: CardDefinition = {
    id: "20275678-3488-43d8-a93b-993e2267ab07",
    name: "Ghosts of the Damned",
    oracleText: "{T}: Target creature gets -1/-0 until end of turn.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "ghosts-of-the-damned-debuff",
            oracleText: "{T}: Target creature gets -1/-0 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, -1, 0, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Fallen Angel — Flying; "Sacrifice a creature: This creature gets +2/+1 until
// end of turn." (CR 702.9 flying + CR 602.1 sacrifice-another cost via
// `sacrificeFilter`, CR 611.1 buff.)
export const fallenAngel: CardDefinition = {
    id: "0f4174e4-0be8-49b5-8c52-22001790f6eb",
    name: "Fallen Angel",
    oracleText:
        "Flying\nSacrifice a creature: This creature gets +2/+1 until end of turn.",
    manaCost: { X: 3, B: 2 },
    types: ["Creature"],
    subtypes: ["Angel"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "fallen-angel-feast",
            oracleText:
                "Sacrifice a creature: This creature gets +2/+1 until end of turn.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    2,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Hell's Caretaker — "{T}, Sacrifice a creature: Return target creature card
// from your graveyard to the battlefield. Activate only during your upkeep."
// (CR 602.5b activation-window restriction + CR 400.7 reanimation.)
export const hellsCaretaker: CardDefinition = {
    id: "336b3b8f-d104-4f06-ad4f-c92b8a9038ca",
    name: "Hell's Caretaker",
    oracleText:
        "{T}, Sacrifice a creature: Return target creature card from your graveyard to the battlefield. Activate only during your upkeep.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "hells-caretaker-reanimate",
            oracleText:
                "{T}, Sacrifice a creature: Return target creature card from your graveyard to the battlefield. Activate only during your upkeep.",
            cost: { tap: true, sacrificeFilter: { types: "Creature" } },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "graveyard-card") {
                    ctx.returnToBattlefield(
                        ctx.controller,
                        target.id,
                        "graveyard"
                    );
                }
            },
        },
    ],
};

// --- Auras (CR 303 — Enchant land) ----------------------------------------

// Blight — "Enchant land. When enchanted land becomes tapped, destroy it."
// (CR 303.4 host trigger via the tapped factory → CR 701.7 destroy.)
export const blight: CardDefinition = {
    id: "9ca19b39-4201-463c-bd40-fbffa31c9eda",
    name: "Blight",
    oracleText: "Enchant land\nWhen enchanted land becomes tapped, destroy it.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Land", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "blight-destroy-land",
            oracleText: "When enchanted land becomes tapped, destroy it.",
            scope: "any",
            // Fire only for the aura's own host (CR 303.4b).
            condition: (event, self) => event.permanentId === self.attachedTo,
            resolve: (ctx) => {
                const host = ctx.getAttachedToId();
                if (host) ctx.destroy({ type: "permanent", id: host });
            },
        }),
    ],
};

// --- Removal / sweeper spells (CR 701.7) -----------------------------------

// Hell Swarm — "All creatures get -1/-0 until end of turn." (CR 611.1 one-shot
// team debuff applied per creature on the battlefield.)
export const hellSwarm: CardDefinition = {
    id: "64164d1b-75f4-456e-a717-90ce554dc16c",
    name: "Hell Swarm",
    oracleText: "All creatures get -1/-0 until end of turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                ctx.addTemporaryPTBuff({ type: "permanent", id }, -1, 0, {
                    phase: "end-of-turn",
                });
            }
        }
    },
};

// Hellfire — "Destroy all nonblack creatures. Hellfire deals X plus 3 damage to
// you, where X is the number of creatures that died this way." (CR 701.7 mass
// destroy filtered on colour + CR 614.5 count of permanents destroyed this way,
// then CR 120.1 damage to caster.)
export const hellfire: CardDefinition = {
    id: "362f1fe9-20af-434c-9957-7a1a564d89e6",
    name: "Hellfire",
    oracleText:
        "Destroy all nonblack creatures. Hellfire deals X plus 3 damage to you, where X is the number of creatures that died this way.",
    manaCost: { X: 2, B: 3 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        // Colour-aware sweep: `destroyAll` doesn't populate colours, so drive
        // the destroy off the colour-aware id query (CR 202.2). "Nonblack" is
        // the set difference between all creatures and the black ones; tally
        // how many were actually put into a graveyard (CR 614.5).
        let died = 0;
        for (const pid of ctx.allPlayerIds) {
            const black = new Set(
                ctx.getBattlefieldIds(pid, {
                    types: "Creature",
                    colors: "B",
                })
            );
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
            })) {
                if (black.has(id)) continue;
                if (ctx.destroy({ type: "permanent", id })) died += 1;
            }
        }
        ctx.dealDamage({ type: "player", id: ctx.caster }, died + 3);
    },
};

// --- Drain / burn spells ---------------------------------------------------

// Syphon Soul — "Syphon Soul deals 2 damage to each other player. You gain life
// equal to the damage dealt this way." (CR 120.1 damage to each opponent → CR
// 119.3 lifegain; 2-player so a single opponent contributes 2.)
export const syphonSoul: CardDefinition = {
    id: "f3020304-7a39-411e-b055-3ade72b4bff8",
    name: "Syphon Soul",
    oracleText:
        "Syphon Soul deals 2 damage to each other player. You gain life equal to the damage dealt this way.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        let dealt = 0;
        for (const pid of ctx.allPlayerIds) {
            if (pid === ctx.caster) continue;
            ctx.dealDamage({ type: "player", id: pid }, 2);
            dealt += 2;
        }
        ctx.gainLife(ctx.caster, dealt);
    },
};

// Jovial Evil — "Jovial Evil deals X damage to target opponent, where X is twice
// the number of white creatures that player controls." (CR 202.2 colour count
// snapshot at resolution → CR 120.1 damage.)
export const jovialEvil: CardDefinition = {
    id: "c993c74c-a574-423b-81c8-96b0a7a6e529",
    name: "Jovial Evil",
    oracleText:
        "Jovial Evil deals X damage to target opponent, where X is twice the number of white creatures that player controls.",
    manaCost: { X: 2, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        const whiteCreatures = ctx.getBattlefieldIds(target.id, {
            types: "Creature",
            colors: "W",
        }).length;
        ctx.dealDamage(target, whiteCreatures * 2);
    },
};

// --- Tricks / regeneration utility -----------------------------------------

// Touch of Darkness — "One or more target creatures become black until end of
// turn." (CR 305.7 layer-5 colour override, end-of-turn duration; variable
// target count, CR 601.2c.)
export const touchOfDarkness: CardDefinition = {
    id: "eda7177f-1354-4008-aaaa-2c8b823ed5e9",
    name: "Touch of Darkness",
    oracleText: "One or more target creatures become black until end of turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.setColorOverride(target, ["B"]);
            }
        }
    },
};

// Horror of Horrors — "Sacrifice a Swamp: Regenerate target black creature."
// (CR 602.1 sacrifice cost via `sacrificeFilter` + CR 701.15a regeneration
// shield on a colour-restricted target.)
export const horrorOfHorrors: CardDefinition = {
    id: "b9f68dc2-c048-41ec-b237-c36fdd99c27d",
    name: "Horror of Horrors",
    oracleText: "Sacrifice a Swamp: Regenerate target black creature.",
    manaCost: { X: 3, B: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "horror-of-horrors-regenerate",
            oracleText: "Sacrifice a Swamp: Regenerate target black creature.",
            cost: { sacrificeFilter: { types: "Land", subtypes: "Swamp" } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, colorFilter: "B" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.applyRegenerationShield(target);
                }
            },
        },
    ],
};

// --- Death triggers (CR 603.2) ---------------------------------------------

// Cyclopean Mummy — "When this creature dies, exile it." (CR 603.2 self death
// trigger → CR 406 exile of the card now in the graveyard.)
export const cyclopeanMummy: CardDefinition = {
    id: "479ccc50-2d72-4adc-901e-fbd4eef2cf92",
    name: "Cyclopean Mummy",
    oracleText: "When this creature dies, exile it.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 1,
    triggeredAbilities: [
        diedTrigger({
            id: "cyclopean-mummy-exile",
            oracleText: "When this creature dies, exile it.",
            scope: "self",
            resolve: (ctx, _event, deadCreature) => {
                // The card is in its owner's graveyard by the time the trigger
                // resolves (CR 603.10); move that exact object to exile
                // (CR 406 zone change).
                ctx.moveCardById(
                    deadCreature.controllerId,
                    deadCreature.id,
                    "graveyard",
                    "exile"
                );
            },
        }),
    ],
};

// Sylvan Library — "At the beginning of your draw step, you may draw two
// additional cards. If you do, choose two cards in your hand drawn this turn.
// For each of those cards, pay 4 life or put the card on top of your library."
// (CR 603.6a draw-step trigger, CR 121.1 draw, CR 118.4 life payment.)
//
// Resolved in steps (CR 608.2) because the draw is IRREVERSIBLE and must run
// once, before the topdeck selection that suspends — a single `resolve` would
// re-draw on every resume (the Bazaar of Baghdad bug). Steps:
//   0. may-draw decision; if accepted, draw two (isolated → drawn once).
//   1. a SINGLE ranged selection over the N = min(2, cardsDrawnThisTurnStill-
//      InHand) cards drawn this turn. The chooser selects 0..N of them to put
//      on top of the library; for each of the N NOT selected, they pay 4 life
//      (CR 118.4). The two printed per-card options ("pay 4 / put on top") are
//      collapsed into one pick — the reachable outcomes are identical (keep
//      both = pay 8, topdeck both = pay 0, mix = pay 4).
//
// `recallChoice` carries the may-draw answer forward (per-step choice keys
// can't be re-read by a later step otherwise). The topdeck commit reads the
// pick back directly from the SAME step's choiceId.
//
// CR 119.4 ("can't pay life you don't have"): a player can keep at most
// floor(life / 4) of the N cards, so the MINIMUM number that must be topdecked
// is max(0, N − floor(life / 4)). With life < 4 all N must be topdecked. The
// ranged choice's `min` enforces this server-side and the Done button enables
// at that minimum client-side.
export const sylvanLibrary: CardDefinition = {
    id: "f486df00-7c4a-4ff0-bb0b-c8b5432ac742",
    name: "Sylvan Library",
    oracleText:
        "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.",
    manaCost: { X: 1, G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        {
            id: "sylvan-library-draw-step",
            oracleText:
                "At the beginning of your draw step, you may draw two additional cards. If you do, choose two cards in your hand drawn this turn. For each of those cards, pay 4 life or put the card on top of your library.",
            event: "PHASE_BEGIN",
            matches: (event: GameEvent, self: PermanentView) =>
                event.type === "PHASE_BEGIN" &&
                event.phase === "DRAW" &&
                event.activePlayerId === self.controllerId,
            resolveSteps: [
                // Step 0 — "you may draw two additional cards" (CR 121.1).
                // Isolated so the draw never re-runs on a later suspension.
                (ctx: SpellContext) => {
                    const accept = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "sylvan-may",
                        options: [
                            { id: "draw", label: "Draw two cards" },
                            { id: "decline", label: "Don't draw" },
                        ],
                        prompt: "Sylvan Library: draw two additional cards?",
                    });
                    if (accept === undefined) return; // suspended
                    if (accept === "draw") ctx.drawCards(ctx.controller, 2);
                },
                // Step 1 — the SINGLE ranged topdeck selection (CR 118.4 /
                // 121.1). The chooser selects which of the N drawn-this-turn
                // cards to put on top of the library; each of the N NOT
                // selected costs 4 life. On resume the picks are read back from
                // this same step's choiceId and committed (topdeck + pay).
                (ctx: SpellContext) => {
                    if (ctx.recallChoice("sylvan-may")?.[0] !== "draw") return;
                    const controller = ctx.controller;
                    const hand = new Set(ctx.getHandIds(controller));
                    // Candidate pool: every card drawn this turn still in hand.
                    // The player may topdeck up to N = min(2, pool) of them
                    // ("choose two cards … put the card on top"); each of the N
                    // they DON'T topdeck costs 4 life.
                    const pool = ctx
                        .getDrawnThisTurnIds(controller)
                        .filter((id) => hand.has(id));
                    const n = Math.min(2, pool.length);
                    if (n === 0) return;
                    // CR 119.4 — keep at most floor(life / 4) cards, so at least
                    // max(0, N − floor(life / 4)) must be topdecked. With
                    // life < 4 all N must go on top.
                    const keepCap = Math.floor(ctx.getLife(controller) / 4);
                    const minTopdeck = Math.max(0, n - keepCap);
                    const picks = ctx.requestChoice({
                        playerId: controller,
                        choiceId: "sylvan-pick",
                        kind: "choose-hand-card",
                        zone: "hand",
                        candidateIds: pool,
                        count: { min: minTopdeck, max: n },
                        prompt: `Select up to ${n} card${n === 1 ? "" : "s"} drawn this turn to put on top of your library; pay 4 life for each of the ${n} you keep.`,
                    });
                    if (picks === undefined) return; // suspended
                    // Commit: selected cards go on top of the library; pay 4
                    // life for each of the N that was NOT selected (kept).
                    const topdeck = picks.filter((id) => hand.has(id));
                    for (const id of topdeck) {
                        ctx.moveHandCardToLibraryTop(controller, id);
                    }
                    const kept = n - topdeck.length;
                    if (kept > 0) ctx.loseLife(controller, 4 * kept);
                },
            ],
        },
    ],
};

// Greed — "{B}, Pay 2 life: Draw a card." (CR 118.4 life payment + CR 121.1
// draw.)
export const greed: CardDefinition = {
    id: "111a16a2-e875-4756-80db-290f9e8606db",
    name: "Greed",
    oracleText: "{B}, Pay 2 life: Draw a card.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "greed-draw",
            oracleText: "{B}, Pay 2 life: Draw a card.",
            cost: { mana: { B: 1 }, life: 2 },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};

// Darkness — "Prevent all combat damage that would be dealt this turn."
// (CR 615 — the global combat-damage prevention used by Fog-style cards.)
export const darkness: CardDefinition = {
    id: "53b04dab-45b7-418b-a0f0-bcf35145fc53",
    name: "Darkness",
    oracleText: "Prevent all combat damage that would be dealt this turn.",
    manaCost: { B: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.preventAllCombatDamage();
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Red free tranche (#374) — every mono-red Legends card expressible with
// existing primitives (keywords, staticEffects / layer system, trigger
// factories, prevention shields, delayed triggers, SpellContext methods).
// Data + resolve() closures only; zero engine change (ADR 0014).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • C3 Rampage (#380, shipped) — Aerathi Berserker (rampage 3), Frost Giant
//     (rampage 2). Now defined at the foot of this file via `rampageTrigger`.
//   • C9 combat-cap World enchantment — Caverns of Despair ("no more than two
//     creatures can attack / block each combat") SHIPPED in the C9 section at
//     the foot of this file (#386).
//   • C5 named counters + upkeep cycle — Primordial Ooze (+1/+1 counters each
//     upkeep, pay {X} or take X damage).
//   • World rule (C2) — Gravity Sphere ("all creatures lose flying"), Land's
//     Edge, Storm World. These carry the World supertype; like every other
//     World-supertype LEG card they are deferred to the world-rule cluster so
//     the supertype and its SBA ship together (mirrors the blue/black tranches).
//
// Out of scope for the whole set (per #369): Tempest Efreet (ante, ADR 0010).
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here):
//   • Backdraft — "half the damage dealt by one of those sorcery spells this
//     turn" needs a per-spell damage tally; no such surface exists.
//   • Blazing Effigy — death damage = 3 + "damage dealt to this by other
//     sources named Blazing Effigy this turn"; no per-source-name damage tally.
//   • Chain Lightning — "that player may pay {R}{R}; if so, copy this spell" is
//     a self-copy of a resolving spell with a may-pay gate; `copyStackItem`
//     copies a DIFFERENT spell still on the stack, not the resolving one.
//   • Crevasse — "creatures with mountainwalk can be blocked as though they
//     didn't have mountainwalk" — buildable with the `landwalk-negation` static
//     (Great Wall / Undertow, #484), `subtypes: ["Mountain"]`. Deferred to its
//     tranche.
//   • Crimson Manticore — "{R}, {T}: deal 1 damage to target attacking OR
//     blocking creature"; `combatRoleFilter` admits only one role at a time, no
//     combined "attacking-or-blocking" target filter.
//   • Disharmony — "untap target attacking creature, remove it from combat,
//     gain control of it until end of turn"; no "until end of turn" control-
//     change condition (only controls-source / source-tapped-power conditions).
//   • Falling Star — a physical-dexterity flip card; not implementable.
//   • Feint — "tap all creatures blocking target attacker; prevent all combat
//     damage by that creature and each creature blocking it" needs a per-attacker
//     blocker-set combat-damage prevention with no primitive.
//   • Firestorm Phoenix — its dies-replacement ("return to hand; until that
//     player's next turn play with it revealed and can't play it") needs a
//     can't-play + revealed-in-hand restriction with no primitive.
//   • Pyrotechnics — "4 damage divided AS YOU CHOOSE among any number of
//     targets"; only `dealDividedDamage` (divided EVENLY, Fireball) exists, no
//     player-chosen damage division.
//   • Quarum Trench Gnomes — "{T}: target Plains produces colorless mana
//     instead of white (indefinitely)" needs a continuous tap-for-mana
//     replacement; no mana-production override static.
//   • Wall of Dust — "whenever this blocks a creature, that creature can't
//     attack during its controller's next turn" needs an other-creature
//     cross-turn attack-lock (same gap flagged for Demonic Torment in black).
// ─────────────────────────────────────────────────────────────────────────────

// --- Vanilla / keyword creatures (CR 110.1 — pure data) -------------------

// Crimson Kobolds — vanilla 0/1 Kobold (CR 110.1; cost {0}, CR 202.1).
export const crimsonKobolds: CardDefinition = {
    id: "13696657-aeef-4add-9a3b-8137fce01fe3",
    name: "Crimson Kobolds",
    oracleText: "",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 0,
    toughness: 1,
};

// Crookshank Kobolds — vanilla 0/1 Kobold (CR 110.1).
export const crookshankKobolds: CardDefinition = {
    id: "7af6b119-7db4-49dd-aaa4-044b8c133f13",
    name: "Crookshank Kobolds",
    oracleText: "",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 0,
    toughness: 1,
};

// Kobolds of Kher Keep — vanilla 0/1 Kobold (CR 110.1).
export const koboldsOfKherKeep: CardDefinition = {
    id: "df0320d9-7c2a-456a-9159-1b4fae67bfb5",
    name: "Kobolds of Kher Keep",
    oracleText: "",
    manaCost: {},
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 0,
    toughness: 1,
};

// Raging Bull — vanilla 2/2 Ox (CR 110.1).
export const ragingBull: CardDefinition = {
    id: "ec10a51c-d2c3-4d14-9a71-9e59155bf980",
    name: "Raging Bull",
    oracleText: "",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Ox"],
    power: 2,
    toughness: 2,
};

// Mountain Yeti — mountainwalk (CR 702.19 landwalk variant) + protection from
// white (CR 702.16).
export const mountainYeti: CardDefinition = {
    id: "09242f08-3bfc-4082-b32f-703c7fed62a0",
    name: "Mountain Yeti",
    oracleText:
        "Mountainwalk (This creature can't be blocked as long as defending player controls a Mountain.)\nProtection from white",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Yeti"],
    power: 3,
    toughness: 3,
    staticAbilities: ["mountainwalk", "protection from white"],
};

// Wall of Earth — Defender (CR 702.3).
export const wallOfEarth: CardDefinition = {
    id: "c12e97c1-ca28-432a-8140-3f08bb4485a3",
    name: "Wall of Earth",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 6,
    staticAbilities: ["defender"],
};

// Wall of Heat — Defender (CR 702.3).
export const wallOfHeat: CardDefinition = {
    id: "a38059a8-be69-4cc1-969b-951c610f2f11",
    name: "Wall of Heat",
    oracleText: "Defender (This creature can't attack.)",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 2,
    toughness: 6,
    staticAbilities: ["defender"],
};

// --- Lord / anthem creatures (CR 611 layer 7c + keyword grant) ------------

// Kobold Taskmaster — "Other Kobold creatures you control get +1/+0."
// (CR 611 filtered anthem excluding self.)
export const koboldTaskmaster: CardDefinition = {
    id: "1b9c63eb-8d4e-4d8b-8637-308459ef036b",
    name: "Kobold Taskmaster",
    oracleText: "Other Kobold creatures you control get +1/+0.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 1,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            power: 1,
            toughness: 0,
        },
    ],
};

// Kobold Drill Sergeant — "Other Kobold creatures you control get +0/+1 and
// have trample." (CR 611 filtered anthem + keyword grant, excluding self.)
export const koboldDrillSergeant: CardDefinition = {
    id: "741b14f8-625d-41be-a734-0efe042a6ee8",
    name: "Kobold Drill Sergeant",
    oracleText:
        "Other Kobold creatures you control get +0/+1 and have trample.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kobold", "Soldier"],
    power: 1,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            power: 0,
            toughness: 1,
        },
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            keyword: "trample",
        },
    ],
};

// Kobold Overlord — first strike (CR 702.7) + "Other Kobold creatures you
// control have first strike." (CR 611 keyword grant, excluding self.)
export const koboldOverlord: CardDefinition = {
    id: "490eeedb-9c03-4dc7-81fd-ae54a7932e4d",
    name: "Kobold Overlord",
    oracleText:
        "First strike\nOther Kobold creatures you control have first strike.",
    manaCost: { X: 1, R: 1 },
    types: ["Creature"],
    subtypes: ["Kobold"],
    power: 1,
    toughness: 2,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id !== source.id &&
                target.controllerId === source.controllerId &&
                target.subtypes.includes("Kobold"),
            keyword: "first strike",
        },
    ],
};

// Beasts of Bogardan — protection from red (CR 702.16) + "gets +1/+1 as long as
// an opponent controls a nontoken white permanent." (CR 611.2c conditional
// self-anthem.)
const BEASTS_OF_BOGARDAN_ID = "f885d776-2953-4ed4-b63f-91dc2b42783b";

export const beastsOfBogardan: CardDefinition = {
    id: BEASTS_OF_BOGARDAN_ID,
    name: "Beasts of Bogardan",
    oracleText:
        "Protection from red\nThis creature gets +1/+1 as long as an opponent controls a nontoken white permanent.",
    manaCost: { X: 4, R: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 3,
    toughness: 3,
    staticAbilities: ["protection from red"],
    staticEffects: [
        {
            kind: "pt-buff",
            // "This creature" — only the source itself (CR 611.2c).
            applies: (target, source) => target.id === source.id,
            condition: (source, state, ctx) =>
                state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId !== source.controllerId &&
                            !c.isToken &&
                            ctx.getColors(c).includes("W")
                    )
                ),
            power: 1,
            toughness: 1,
        },
    ],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Spinal Villain — "{T}: Destroy target blue creature." (CR 701.7 destroy on a
// colour-restricted target, CR 202.2.)
export const spinalVillain: CardDefinition = {
    id: "d6d5e36f-0049-4be8-bf85-8dc0186339a4",
    name: "Spinal Villain",
    oracleText: "{T}: Destroy target blue creature.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "spinal-villain-destroy",
            oracleText: "{T}: Destroy target blue creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, colorFilter: "U" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
    ],
};

// Hyperion Blacksmith — "{T}: You may tap or untap target artifact an opponent
// controls." (CR 701.20 tap/untap; the optional + the tap-or-untap pick are a
// single option choice — choose tap, untap, or decline.)
export const hyperionBlacksmith: CardDefinition = {
    id: "44d499a9-fe7c-4a1a-9eb3-a7fd9f85ae08",
    name: "Hyperion Blacksmith",
    oracleText:
        "{T}: You may tap or untap target artifact an opponent controls.",
    manaCost: { X: 1, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Artificer"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "hyperion-blacksmith-tap-untap",
            oracleText:
                "{T}: You may tap or untap target artifact an opponent controls.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Artifact",
                count: 1,
                controller: "opponent",
            },
            resolveSteps: [
                (ctx: SpellContext) => {
                    const target = ctx.targets[0];
                    if (target?.type !== "permanent") return;
                    const pick = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "hyperion-tap-untap",
                        prompt: "Tap or untap the target artifact?",
                        options: [
                            { id: "tap", label: "Tap" },
                            { id: "untap", label: "Untap" },
                            { id: "decline", label: "Do nothing" },
                        ],
                    });
                    if (pick === undefined) return; // suspended
                    if (pick === "tap") ctx.tap(target);
                    else if (pick === "untap") ctx.untap(target);
                },
            ],
        },
    ],
};

// Wall of Opposition — Defender (CR 702.3) + "{1}: This creature gets +1/+0
// until end of turn." (CR 611.1 repeatable temporary pump.)
export const wallOfOpposition: CardDefinition = {
    id: "2b3d1430-9978-4983-a4fd-d1fa8dea2169",
    name: "Wall of Opposition",
    oracleText:
        "Defender (This creature can't attack.)\n{1}: This creature gets +1/+0 until end of turn.",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 6,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "wall-of-opposition-pump",
            oracleText: "{1}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// --- Auras (CR 303 — Enchant creature) ------------------------------------

// Giant Strength — Enchanted creature gets +2/+2 (CR 303.4, 611).
export const giantStrength: CardDefinition = {
    id: "a86190bb-1f41-4128-b9fb-dfb1d178359d",
    name: "Giant Strength",
    oracleText: "Enchant creature\nEnchanted creature gets +2/+2.",
    manaCost: { R: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 2,
            toughness: 2,
        },
    ],
};

// Immolation — Enchanted creature gets +2/-2 (CR 303.4, 611).
export const immolation: CardDefinition = {
    id: "9b3d34fa-398c-4ea0-a392-6690bd3a615c",
    name: "Immolation",
    oracleText: "Enchant creature\nEnchanted creature gets +2/-2.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 2,
            toughness: -2,
        },
    ],
};

// Eternal Warrior — Enchanted creature has vigilance (CR 303.4 keyword grant,
// CR 702.21).
export const eternalWarrior: CardDefinition = {
    id: "97cdc38e-1d96-4de2-98e2-713f5d4d2180",
    name: "Eternal Warrior",
    oracleText: "Enchant creature\nEnchanted creature has vigilance.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) => target.id === source.attachedTo,
            keyword: "vigilance",
        },
    ],
};

// The Brute — "Enchanted creature gets +1/+0." + "{R}{R}{R}: Regenerate
// enchanted creature." (CR 303.4 pt-buff + a host-aware regeneration ability,
// CR 701.15a.)
export const theBrute: CardDefinition = {
    id: "f9ffb265-872f-47b3-974c-92bcbebd557e",
    name: "The Brute",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+0.\n{R}{R}{R}: Regenerate enchanted creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.attachedTo,
            power: 1,
            toughness: 0,
        },
    ],
    activatedAbilities: [
        {
            id: "the-brute-regenerate",
            oracleText: "{R}{R}{R}: Regenerate enchanted creature.",
            cost: { mana: { R: 3 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const host = ctx.getAttachedToId();
                if (host)
                    ctx.applyRegenerationShield({
                        type: "permanent",
                        id: host,
                    });
            },
        },
    ],
};

// --- Pump / colour-change spells (CR 611.1, end-of-turn duration) ----------

// Dwarven Song — "One or more target creatures become red until end of turn."
// (CR 305.7 layer-5 colour override, end-of-turn duration; variable count,
// CR 601.2c.)
export const dwarvenSong: CardDefinition = {
    id: "29a50f72-9524-4440-9380-9d3e0b693351",
    name: "Dwarven Song",
    oracleText: "One or more target creatures become red until end of turn.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.setColorOverride(target, ["R"]);
            }
        }
    },
};

// Blood Lust — "If target creature has toughness 5 or greater, it gets +4/-4
// until end of turn. Otherwise, it gets +4/-X until end of turn, where X is its
// toughness minus 1." (CR 611.1 temporary P/T; the toughness branch snapshots
// effective toughness at resolution. The -X case always leaves toughness 1 —
// +4/-(T-1) makes the new toughness T - (T-1) = 1.)
export const bloodLust: CardDefinition = {
    id: "fbbf1a9c-8b94-4ee7-92db-65b531149990",
    name: "Blood Lust",
    oracleText:
        "If target creature has toughness 5 or greater, it gets +4/-4 until end of turn. Otherwise, it gets +4/-X until end of turn, where X is its toughness minus 1.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        const toughness = ctx.getToughness(target);
        const toughnessDelta = toughness >= 5 ? -4 : -(toughness - 1);
        ctx.addTemporaryPTBuff(target, 4, toughnessDelta, {
            phase: "end-of-turn",
        });
    },
};

// Glyph of Destruction — "Target blocking Wall you control gets +10/+0 until
// end of combat. Prevent all damage that would be dealt to it this turn.
// Destroy it at the beginning of the next end step." (CR 611.1 pump until end
// of combat + CR 615 prevention shield + CR 603.7a delayed destroy.)
export const glyphOfDestruction: CardDefinition = {
    id: "8e9c153c-9224-491b-bc84-8a9f0a83ee5a",
    name: "Glyph of Destruction",
    oracleText:
        "Target blocking Wall you control gets +10/+0 until end of combat. Prevent all damage that would be dealt to it this turn. Destroy it at the beginning of the next end step.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "Creature",
        count: 1,
        controller: "you",
        subtypeFilter: "Wall",
        combatRoleFilter: "blocking",
    },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "permanent") return;
        ctx.addTemporaryPTBuff(target, 10, 0, { phase: "end-of-combat" });
        // "Prevent all damage to it this turn" — a shield large enough to
        // absorb any realistic turn's damage (CR 615, purged at end of turn).
        ctx.preventNextNDamageToTarget(target, 9999, { phase: "end-of-turn" });
        // "Destroy it at the beginning of the next end step" (CR 603.7a).
        ctx.scheduleDelayedTrigger(
            glyphOfDestruction.id,
            "glyph-of-destruction-destroy",
            "next-end-step",
            { permanentId: target.id }
        );
    },
    delayedTriggers: [
        {
            id: "glyph-of-destruction-destroy",
            oracleText:
                "At the beginning of the next end step, destroy the enchanted Wall.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                if (payload.permanentId)
                    ctx.destroy({ type: "permanent", id: payload.permanentId });
            },
        },
    ],
};

// --- Removal / modal spells (CR 700.2, 701.7) ------------------------------

// Active Volcano — modal: "Destroy target blue permanent." OR "Return target
// Island to its owner's hand." (CR 700.2 modal spell.)
export const activeVolcano: CardDefinition = {
    id: "ad402e65-6fac-4005-a2d4-592983df0c30",
    name: "Active Volcano",
    oracleText:
        "Choose one —\n• Destroy target blue permanent.\n• Return target Island to its owner's hand.",
    manaCost: { R: 1 },
    types: ["Instant"],
    modes: [
        {
            id: "destroy-blue",
            label: "Destroy target blue permanent",
            oracleText: "Destroy target blue permanent.",
            targetRequirement: { type: "any", count: 1, colorFilter: "U" },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
        {
            id: "return-island",
            label: "Return target Island to its owner's hand",
            oracleText: "Return target Island to its owner's hand.",
            targetRequirement: {
                type: "Land",
                count: 1,
                subtypeFilter: "Island",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.returnToHand(target);
            },
        },
    ],
};

// --- Hand / library disruption (CR 121, 701.20) ----------------------------

// Winds of Change — "Each player shuffles the cards from their hand into their
// library, then draws that many cards." (Composed: count each hand, move
// hand → library, shuffle, redraw that many. CR 701.20 / 121.1.)
export const windsOfChange: CardDefinition = {
    id: "186fd917-8d65-4de5-8546-a32a5f6d3bab",
    name: "Winds of Change",
    oracleText:
        "Each player shuffles the cards from their hand into their library, then draws that many cards.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            const handSize = ctx.getHandSize(pid);
            ctx.moveZone(pid, "hand", "library");
            ctx.shuffleLibrary(pid);
            ctx.drawCards(pid, handSize);
        }
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Green free tranche (#375) — every mono-green Legends card expressible with
// existing primitives (keywords, staticEffects / layer system incl. pt-cda,
// block-restriction static, trigger factories, library tutor, SpellContext
// methods). Data + resolve() closures only; zero engine change (ADR 0014).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • C3 Rampage (#380, shipped) — Craw Giant (rampage 2), Wolverine Pack
//     (rampage 2). Now defined at the foot of this file via `rampageTrigger`.
//   • C4 bands-with-other — Master of the Hunt (Wolves-of-the-Hunt token band),
//     Shelkin Brownie ("loses all bands-with-other abilities").
//   • C5 named counters — Cocoon (pupa counters), Whirling Dervish (+1/+1
//     counter on its own combat-damage end-step trigger).
//   • World rule (C2) — Concordant Crossroads, Living Plane, Revelation. These
//     carry the World supertype; like every other World-supertype LEG card they
//     are deferred to the world-rule cluster so the supertype and its SBA ship
//     together (mirrors the blue/black/red tranches).
//   • C9 conditional attack restriction (World) — Arboria. SHIPPED in the C9
//     section at the foot of this file (#386).
//
// Out of scope for the whole set (per #369): Rebirth (ante, ADR 0010).
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here):
//   • Aisling Leprechaun / Floral Spuzzem — "whenever this blocks / becomes
//     blocked" and "whenever this attacks and isn't blocked" need a combat
//     attack/block triggered-ability factory; only ETB/death/tap/cast/phase
//     factories exist.
//   • Avoid Fate — "counter target instant or Aura spell that targets a
//     permanent you control" needs a spell-target predicate gating the legal
//     spell on what IT targets; the `spell` target requirement only filters the
//     spell's own types, not its targets.
//   • Deadfall — "creatures with forestwalk can be blocked as though they
//     didn't have forestwalk" — buildable with the `landwalk-negation` static
//     (Great Wall / Undertow, #484), `subtypes: ["Forest"]`. Deferred to its
//     tranche.
//   • Eureka — "starting with you, each player may put a permanent card from
//     hand onto the battlefield; repeat until no one does" needs an alternating
//     multi-player put-from-hand loop with no primitive.
//   • Glyph of Reincarnation — destroy creatures a target Wall blocked this turn
//     and reanimate per their last-blocked controller needs per-Wall blocked-
//     history tracking with no surface.
//   • Ichneumon Druid — "other than the first instant that player casts each
//     turn" needs a per-player per-turn instant-cast tally not surfaced to
//     trigger conditions.
//   • Radjan Spirit — "target creature loses flying until end of turn" needs a
//     temporary (duration-scoped) keyword-removal; only static keyword-remove
//     (Earthbind) and keyword GRANT (Jump) exist.
//   • Reincarnation — "when that creature dies this turn, return a creature from
//     its owner's graveyard" needs a per-target delayed dies-watcher; the
//     delayed-trigger timings are phase boundaries only, not "when X dies".
//   • Rust — "counter target activated ability from an artifact source" needs an
//     ability-on-the-stack target type that does not exist.
//   • Subdue — "prevent all combat damage that would be dealt BY target
//     creature" needs a per-source combat-damage prevention; only the global
//     Fog-style `preventAllCombatDamage` exists.
//   • Untamed Wilds — "search your library for a basic land card" needs a
//     basic-supertype filter on hidden library cards; `getLibraryCards` exposes
//     only id/types/manaValue, so the candidate allow-list can't isolate
//     basics without widening that accessor (an engine change).
//   • Willow Satyr — "gain control of target legendary creature for as long as
//     you control this AND this remains tapped" needs a control-change condition
//     combining controls-source + source-tapped; only the separate
//     `controller-controls-source` and `source-tapped-and-power-ge` kinds exist
//     (same may-not-untap clause deferred for Old Man of the Sea).
//   • Wood Elemental — "P/T each equal to the number of Forests sacrificed as it
//     entered" needs an entry-time sacrifice count stored and read by a CDA (or
//     an indefinite base-P/T set); only phase-scoped `setBasePT` exists.
// ─────────────────────────────────────────────────────────────────────────────

// --- Vanilla / keyword creatures (CR 110.1 / 702 — pure data) -------------

// Barbary Apes — vanilla 2/2 Ape (CR 110.1).
export const barbaryApes: CardDefinition = {
    id: "df25ffdd-995d-46ae-856b-f6368f9438ed",
    name: "Barbary Apes",
    oracleText: "",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Ape"],
    power: 2,
    toughness: 2,
};

// Durkwood Boars — vanilla 4/4 Boar (CR 110.1).
export const durkwoodBoars: CardDefinition = {
    id: "8d41f08b-68fb-45f2-bdc9-488baedc7d6f",
    name: "Durkwood Boars",
    oracleText: "",
    manaCost: { X: 4, G: 1 },
    types: ["Creature"],
    subtypes: ["Boar"],
    power: 4,
    toughness: 4,
};

// Moss Monster — vanilla 3/6 Elemental (CR 110.1).
export const mossMonster: CardDefinition = {
    id: "9903c043-9a7a-4994-b532-136d4c46edfd",
    name: "Moss Monster",
    oracleText: "",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Elemental"],
    power: 3,
    toughness: 6,
};

// Cat Warriors — forestwalk (CR 702.19 landwalk variant).
export const catWarriors: CardDefinition = {
    id: "d2187a64-2823-4f58-ad35-70f8913db2dc",
    name: "Cat Warriors",
    oracleText:
        "Forestwalk (This creature can't be blocked as long as defending player controls a Forest.)",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Cat", "Warrior"],
    power: 2,
    toughness: 2,
    staticAbilities: ["forestwalk"],
};

// Hornet Cobra — first strike (CR 702.7).
export const hornetCobra: CardDefinition = {
    id: "27180bad-9bbc-462b-8832-626dc403a3fd",
    name: "Hornet Cobra",
    oracleText: "First strike",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 2,
    toughness: 1,
    staticAbilities: ["first strike"],
};

// Elven Riders — "can't be blocked except by Walls and/or creatures with
// flying" (CR 509.1b block restriction via a `block-restriction` static on the
// attacker side; the combat validator scans the attacker's own statics).
export const elvenRiders: CardDefinition = {
    id: "ad1d349b-b5ab-4b2b-9b39-f8d8f6374aa5",
    name: "Elven Riders",
    oracleText:
        "This creature can't be blocked except by Walls and/or creatures with flying.",
    manaCost: { X: 3, G: 2 },
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 3,
    toughness: 3,
    staticEffects: [
        {
            // A `block-restriction` declared on a creature's own
            // `staticEffects` is intrinsic to that creature: `side: "attacker"`
            // means `self` is this attacker and `opponent` is the candidate
            // blocker (CR 509.1b). Legal blockers are Walls and/or creatures
            // with flying (CR 702.9).
            kind: "block-restriction",
            id: "elven-riders-walls-or-flyers-only",
            side: "attacker" as const,
            predicate: (_self, opponent) =>
                opponent.subtypes.includes("Wall") ||
                (
                    (opponent as { staticAbilities?: string[] })
                        .staticAbilities ?? []
                ).includes("flying"),
            oracleText:
                "This creature can't be blocked except by Walls and/or creatures with flying.",
        },
    ],
};

// --- pt-cda creatures (CR 604.3 — characteristic-defining P/T) -------------

// Rabid Wombat — Vigilance; "This creature gets +2/+2 for each Aura attached to
// it." (CR 702.21 vigilance + a `pt-cda` that counts Auras attached to the
// source at stat-read time, added on top of its base 0/1.)
export const rabidWombat: CardDefinition = {
    id: "9d9b9eb8-6367-4ab5-8e00-a9c9e1d69032",
    name: "Rabid Wombat",
    oracleText:
        "Vigilance\nThis creature gets +2/+2 for each Aura attached to it.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Wombat"],
    power: 0,
    toughness: 1,
    staticAbilities: ["vigilance"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                let auras = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.subtypes.includes("Aura") &&
                            p.attachedTo === source.id
                        ) {
                            auras++;
                        }
                    }
                }
                return { power: auras * 2, toughness: auras * 2 };
            },
        },
    ],
};

// --- Activated-ability creatures (CR 605) ----------------------------------

// Emerald Dragonfly — Flying; "{G}{G}: This creature gains first strike until
// end of turn." (CR 702.9 flying + CR 611.1b end-of-turn keyword grant.)
export const emeraldDragonfly: CardDefinition = {
    id: "a3e81250-52c3-49f6-be43-17c34339e177",
    name: "Emerald Dragonfly",
    oracleText:
        "Flying\n{G}{G}: This creature gains first strike until end of turn.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "emerald-dragonfly-first-strike",
            oracleText:
                "{G}{G}: This creature gains first strike until end of turn.",
            cost: { mana: { G: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.grantStaticAbility(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "first strike",
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Fire Sprites — Flying; "{G}, {T}: Add {R}." (CR 702.9 flying + CR 605.1a mana
// ability — `useStack: false`, resolves immediately, no priority.)
export const fireSprites: CardDefinition = {
    id: "d26fa79a-ede8-4c80-98d5-f49696f8104d",
    name: "Fire Sprites",
    oracleText: "Flying\n{G}, {T}: Add {R}.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "fire-sprites-mana",
            oracleText: "{G}, {T}: Add {R}.",
            cost: { mana: { G: 1 }, tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ R: 1 }),
            manaProduced: { R: 1 },
        },
    ],
};

// Killer Bees — Flying; "{G}: This creature gets +1/+1 until end of turn."
// (CR 702.9 flying + CR 611.1 repeatable temporary buff.)
export const killerBees: CardDefinition = {
    id: "2e30b5ff-1239-4c4d-ac7c-554ecf8e1e27",
    name: "Killer Bees",
    oracleText: "Flying\n{G}: This creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, G: 2 },
    types: ["Creature"],
    subtypes: ["Insect"],
    power: 0,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "killer-bees-pump",
            oracleText: "{G}: This creature gets +1/+1 until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Pixie Queen — Flying; "{G}{G}{G}, {T}: Target creature gains flying until end
// of turn." (CR 702.9 flying + CR 611.1b keyword grant on a chosen target.)
export const pixieQueen: CardDefinition = {
    id: "b9527c2a-23bb-4d33-9e72-6e0ab3de0e6b",
    name: "Pixie Queen",
    oracleText:
        "Flying\n{G}{G}{G}, {T}: Target creature gains flying until end of turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Faerie"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "pixie-queen-grant-flying",
            oracleText:
                "{G}{G}{G}, {T}: Target creature gains flying until end of turn.",
            cost: { mana: { G: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.grantStaticAbility(target, "flying", {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Pradesh Gypsies — "{1}{G}, {T}: Target creature gets -2/-0 until end of
// turn." (CR 611.1 temporary debuff via a tap ability.)
export const pradeshGypsies: CardDefinition = {
    id: "0370330d-83d9-44d2-a1ed-c4827edc60fd",
    name: "Pradesh Gypsies",
    oracleText: "{1}{G}, {T}: Target creature gets -2/-0 until end of turn.",
    manaCost: { X: 2, G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Nomad"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "pradesh-gypsies-debuff",
            oracleText:
                "{1}{G}, {T}: Target creature gets -2/-0 until end of turn.",
            cost: { mana: { X: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, -2, 0, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// --- Burn spells scaling on a per-player count (CR 120.1) ------------------

// Storm Seeker — "Storm Seeker deals damage to target player equal to the
// number of cards in that player's hand." (CR 120.1 damage = hand-size snapshot
// at resolution, CR 402.1.)
export const stormSeeker: CardDefinition = {
    id: "3b66d0cc-84d7-41ad-b0e7-74ebf604543f",
    name: "Storm Seeker",
    oracleText:
        "Storm Seeker deals damage to target player equal to the number of cards in that player's hand.",
    manaCost: { X: 3, G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        ctx.dealDamage(target, ctx.getHandSize(target.id));
    },
};

// Typhoon — "Typhoon deals damage to each opponent equal to the number of
// Islands that player controls." (CR 120.1 damage scaled per opponent's Island
// count, CR 205.3.)
export const typhoon: CardDefinition = {
    id: "254e0403-67d8-4e73-8d89-c901ebeba49f",
    name: "Typhoon",
    oracleText:
        "Typhoon deals damage to each opponent equal to the number of Islands that player controls.",
    manaCost: { X: 2, G: 1 },
    types: ["Sorcery"],
    resolve: (ctx: SpellContext) => {
        for (const pid of ctx.allPlayerIds) {
            if (pid === ctx.caster) continue;
            const islands = ctx.getBattlefieldIds(pid, {
                types: "Land",
                subtypes: "Island",
            }).length;
            if (islands > 0) {
                ctx.dealDamage({ type: "player", id: pid }, islands);
            }
        }
    },
};

// --- Combat tricks (CR 611.1) ----------------------------------------------

// Winter Blast — "Tap X target creatures. Winter Blast deals 2 damage to each
// of those creatures with flying." (CR 107.3 X chosen on cast → CR 701.20a tap
// of each target → CR 120.1 damage gated on flying, snapshot at resolution.)
export const winterBlast: CardDefinition = {
    id: "fb846366-2105-4999-8af1-a11687f42e17",
    name: "Winter Blast",
    oracleText:
        "Tap X target creatures. Winter Blast deals 2 damage to each of those creatures with flying.",
    manaCost: { X: "X", G: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: "X" },
    resolve: (ctx: SpellContext) => {
        // "each of those creatures with flying" — derive the flying set from
        // the live battlefield (CR 702.9, snapshot at resolution) and gate the
        // 2 damage on membership.
        const flyers = new Set<string>();
        for (const pid of ctx.allPlayerIds) {
            for (const id of ctx.getBattlefieldIds(pid, {
                types: "Creature",
                requireAbility: "flying",
            })) {
                flyers.add(id);
            }
        }
        for (const target of ctx.targets) {
            if (target.type !== "permanent") continue;
            ctx.tap(target);
            if (flyers.has(target.id)) ctx.dealDamage(target, 2);
        }
    },
};

// Sylvan Paradise — "One or more target creatures become green until end of
// turn." (CR 305.7 layer-5 colour override, end-of-turn duration; variable
// target count, CR 601.2c.)
export const sylvanParadise: CardDefinition = {
    id: "f323c3bb-cece-4035-b1a7-c4817cf7a08c",
    name: "Sylvan Paradise",
    oracleText: "One or more target creatures become green until end of turn.",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: { min: 1 } },
    resolve: (ctx: SpellContext) => {
        for (const target of ctx.targets) {
            if (target.type === "permanent") {
                ctx.setColorOverride(target, ["G"]);
            }
        }
    },
};

// Untamed Wilds ("search your library for a basic land card, put it onto the
// battlefield, then shuffle") is SKIPPED: `getLibraryCards` exposes only
// `{ id, types, manaValue }`, so the basic-land restriction cannot be
// expressed as a `candidateIds` allow-list without widening that accessor to
// carry supertypes — an engine change out of scope for this data-only tranche.

// ─────────────────────────────────────────────────────────────────────────────
// Multicolor / gold free tranche (#376) — every multicolor (2+ colors) Legends
// card expressible with existing primitives (keywords, staticEffects / layer
// system incl. pt-cda, trigger factories, prevention shields, mana abilities,
// createToken, control/regeneration machinery, SpellContext methods). Data +
// resolve() closures only; zero engine change (ADR 0014). Almost every
// multicolor card in Legends is a Legendary creature — the simple ones ship
// here carrying the `Legendary` supertype as data (CR 205.4a); they become
// fully rules-correct once the legend-rule SBA (#369 C1) lands.
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • Elder Dragon Legends (upkeep pay-or-sacrifice, C7): Arcades Sabboth,
//     Nicol Bolas, Palladia-Mors, Vaevictis Asmadi. (Chromium's Rampage 2 +
//     Flying ship with C3 (#380) at the foot of this file; its upkeep
//     pay-or-sacrifice still belongs to C7.)
//   • Rampage N (C3, #380, shipped): Hunding Gjornersen (rampage 1) and
//     Marhault Elsdragon (rampage 1) are now defined at the foot of this file.
//     Gabriel Angelfire (its upkeep choice includes "rampage 3") still waits on
//     its choice cluster; its Rampage piece reuses `rampageTrigger` when built.
//   • Banding / bands-with-other (C4): Ayesha Tanaka.
//   • Shroud / can't-be-targeted (C6): Bartel Runeaxe, Tetsuo Umezawa.
//   • Named counters (C5): Rasputin Dreamweaver (dream counters).
//   • Control-change-to-opponent upkeep penalty + named anthem (cluster-shaped):
//     Rohgahh of Kher Keep.
//
// Cards that genuinely need an unbuilt primitive are SKIPPED (not built here):
//   • Axelrod Gunnarson — "whenever a creature dealt damage by Axelrod this
//     turn dies, ..." needs a per-source combat-damage tally keyed to the
//     dealer; no such surface exists (same gap flagged for Blazing Effigy).
//   • Gosta Dirk / Lord Magnus / Ur-Drago — each carries a landwalk-suppression
//     static ("creatures with islandwalk/forestwalk/plainswalk/swampwalk can be
//     blocked as though they didn't have it"). The `landwalk-negation` static
//     (Great Wall / Undertow, #484) now expresses the suppression half with a
//     multi-subtype `subtypes` array; these creatures are buildable once their
//     remaining halves (keyword grant + P/T) are wired in a follow-up.
//   • Hazezon Tamar — delayed X 1/1 Sand Warrior tokens at the next upkeep plus
//     a leaves-the-battlefield "exile all Sand Warriors" sweep keyed by token
//     name across both players; the cross-board named-token tracking has no
//     primitive.
//   • Johan — "attacking doesn't cause creatures you control to tap this combat"
//     is a combat-tap replacement with no primitive.
//   • Lady Caleria / Tor Wauki — "{T}: deal N damage to target attacking OR
//     blocking creature"; `combatRoleFilter` admits only one role at a time
//     (same gap flagged for Crimson Manticore).
//   • Lady Evangela — "prevent all combat damage that would be dealt BY target
//     creature this turn"; only `preventAllCombatDamageToAndBy` (both
//     directions, Ebony Horse) exists — a by-only shield would over-prevent.
//   • Nebuchadnezzar — "reveal X cards at random from hand, then discard all
//     with the chosen name" needs a name-guess + random-reveal-from-hand
//     primitive with no surface.
//   • Ramses Overdark — "destroy target enchanted creature"; no
//     enchanted-permanent target filter on `TargetRequirement`.
//   • Stangg — creates a linked legendary token twin with a sacrifice-the-pair
//     LTB linkage (token leaves → sacrifice Stangg, Stangg leaves → exile
//     token); no token-linkage primitive.
// ─────────────────────────────────────────────────────────────────────────────

// --- Vanilla / keyword multicolor creatures (CR 110.1, 702 — pure data) ----

// Barktooth Warbeard — vanilla legendary 6/5 (CR 205.4a Legendary supertype).
export const barktoothWarbeard: CardDefinition = {
    id: "0ea52228-f8ad-4623-9e05-f162473bfc03",
    name: "Barktooth Warbeard",
    oracleText: "",
    manaCost: { X: 4, B: 1, R: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 6,
    toughness: 5,
};

// Jedit Ojanen — vanilla legendary 5/5.
export const jeditOjanen: CardDefinition = {
    id: "97b80124-2b59-425c-93cc-9b032e631c6e",
    name: "Jedit Ojanen",
    oracleText: "",
    manaCost: { X: 4, W: 2, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Cat", "Warrior"],
    power: 5,
    toughness: 5,
};

// Jerrard of the Closed Fist — vanilla legendary 6/5.
export const jerrardOfTheClosedFist: CardDefinition = {
    id: "7f841918-813b-4784-ab57-907185b0a355",
    name: "Jerrard of the Closed Fist",
    oracleText: "",
    manaCost: { X: 3, R: 1, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 6,
    toughness: 5,
};

// Kasimir the Lone Wolf — vanilla legendary 5/3.
export const kasimirTheLoneWolf: CardDefinition = {
    id: "45b1e60d-54dd-41cd-b9a2-00890725a3df",
    name: "Kasimir the Lone Wolf",
    oracleText: "",
    manaCost: { X: 4, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 5,
    toughness: 3,
};

// Sir Shandlar of Eberyn — vanilla legendary 4/7.
export const sirShandlarOfEberyn: CardDefinition = {
    id: "31570ded-f5e3-44c4-b95f-294ac10b2cd2",
    name: "Sir Shandlar of Eberyn",
    oracleText: "",
    manaCost: { X: 4, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 4,
    toughness: 7,
};

// Sivitri Scarzam — vanilla legendary 6/4.
export const sivitriScarzam: CardDefinition = {
    id: "9c12ee9e-db13-4b4d-a061-b6566f538f09",
    name: "Sivitri Scarzam",
    oracleText: "",
    manaCost: { X: 5, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 6,
    toughness: 4,
};

// The Lady of the Mountain — vanilla legendary 5/5.
export const theLadyOfTheMountain: CardDefinition = {
    id: "83717eb2-220e-4086-be09-dee9174798b8",
    name: "The Lady of the Mountain",
    oracleText: "",
    manaCost: { X: 4, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Giant"],
    power: 5,
    toughness: 5,
};

// Tobias Andrion — vanilla legendary 4/4.
export const tobiasAndrion: CardDefinition = {
    id: "cac56eda-5ed3-4abd-beec-f5063fbf930a",
    name: "Tobias Andrion",
    oracleText: "",
    manaCost: { X: 3, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Advisor"],
    power: 4,
    toughness: 4,
};

// Torsten Von Ursus — vanilla legendary 5/5.
export const torstenVonUrsus: CardDefinition = {
    id: "5fd99522-4a91-4ccd-91bf-5f32a6ac3510",
    name: "Torsten Von Ursus",
    oracleText: "",
    manaCost: { X: 3, G: 2, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Soldier"],
    power: 5,
    toughness: 5,
};

// Ramirez DePietro — first strike (CR 702.7) legendary 4/3.
export const ramirezDePietro: CardDefinition = {
    id: "e5c66c61-aadf-433b-9958-fc9b44b327b9",
    name: "Ramirez DePietro",
    oracleText: "First strike",
    manaCost: { X: 3, U: 1, B: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Pirate"],
    power: 4,
    toughness: 3,
    staticAbilities: ["first strike"],
};

// --- Characteristic-defining P/T (CR 604.3) --------------------------------

// Dakkon Blackblade — "Dakkon Blackblade's power and toughness are each equal
// to the number of lands you control." (CR 604.3 pt-cda; base 0/0, the CDA
// supplies the whole value from a land count.)
export const dakkonBlackblade: CardDefinition = {
    id: "fbfd1278-1486-4516-8846-007ce1985ee9",
    name: "Dakkon Blackblade",
    oracleText:
        "Dakkon Blackblade's power and toughness are each equal to the number of lands you control.",
    manaCost: { X: 2, W: 1, U: 2, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 0,
    toughness: 0,
    staticEffects: [
        {
            kind: "pt-cda",
            applies: EFFECT_AFFECTS_SELF,
            compute: (source, state) => {
                let lands = 0;
                for (const player of state.players) {
                    for (const p of player.battlefield) {
                        if (
                            p.controllerId === source.controllerId &&
                            p.types.includes("Land")
                        ) {
                            lands++;
                        }
                    }
                }
                return { power: lands, toughness: lands };
            },
        },
    ],
};

// --- Filtered anthem (CR 611 layer 7c) -------------------------------------

// Jacques le Vert — "Green creatures you control get +0/+2." (CR 611 filtered
// anthem keyed on colour + controller.)
export const jacquesLeVert: CardDefinition = {
    id: "ee5a45b1-169b-468e-9251-424c09cd7f0f",
    name: "Jacques le Vert",
    oracleText: "Green creatures you control get +0/+2.",
    manaCost: { X: 1, R: 1, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 3,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source, ctx) =>
                ctx.isCreature(target) &&
                target.controllerId === source.controllerId &&
                ctx.getColors(target).includes("G"),
            power: 0,
            toughness: 2,
        },
    ],
};

// --- Spell-cast trigger (CR 603.2) -----------------------------------------

// Sol'kanar the Swamp King — Swampwalk (CR 702.13) + "Whenever a player casts a
// black spell, you gain 1 life." (CR 603.2 spell-cast trigger, any caster,
// colour-filtered → CR 119.3 lifegain.)
export const solkanarTheSwampKing: CardDefinition = {
    id: "7a20dcb0-5350-40e0-82d3-c8d0186fc9d2",
    name: "Sol'kanar the Swamp King",
    oracleText:
        "Swampwalk (This creature can't be blocked as long as defending player controls a Swamp.)\nWhenever a player casts a black spell, you gain 1 life.",
    manaCost: { X: 2, U: 1, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Demon"],
    power: 5,
    toughness: 5,
    staticAbilities: ["swampwalk"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "solkanar-black-spell-lifegain",
            oracleText:
                "Whenever a player casts a black spell, you gain 1 life.",
            scope: "any",
            filter: { colors: "B" },
            resolve: (ctx) => ctx.gainLife(ctx.controller, 1),
        }),
    ],
};

// --- Activated abilities (CR 602) ------------------------------------------

// Adun Oakenshield — "{B}{R}{G}, {T}: Return target creature card from your
// graveyard to your hand." (CR 602 activated ability + CR 400.7 graveyard→hand
// move on a chosen graveyard creature.)
export const adunOakenshield: CardDefinition = {
    id: "60252226-a102-4d88-9b80-42d021b5184d",
    name: "Adun Oakenshield",
    oracleText:
        "{B}{R}{G}, {T}: Return target creature card from your graveyard to your hand.",
    manaCost: { B: 1, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Knight"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "adun-oakenshield-regrowth",
            oracleText:
                "{B}{R}{G}, {T}: Return target creature card from your graveyard to your hand.",
            cost: { mana: { B: 1, R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "graveyard-card") {
                    ctx.moveCardById(
                        ctx.controller,
                        target.id,
                        "graveyard",
                        "hand"
                    );
                }
            },
        },
    ],
};

// Angus Mackenzie — "{G}{W}{U}, {T}: Prevent all combat damage that would be
// dealt this turn. Activate only before the combat damage step." (CR 602.5b
// activation-window restriction + CR 615 fog-style global combat-damage
// prevention.)
export const angusMackenzie: CardDefinition = {
    id: "57264bd9-94f6-4d4d-baff-2b2900585635",
    name: "Angus Mackenzie",
    oracleText:
        "{G}{W}{U}, {T}: Prevent all combat damage that would be dealt this turn. Activate only before the combat damage step.",
    manaCost: { G: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "angus-mackenzie-fog",
            oracleText:
                "{G}{W}{U}, {T}: Prevent all combat damage that would be dealt this turn. Activate only before the combat damage step.",
            cost: { mana: { G: 1, W: 1, U: 1 }, tap: true },
            useStack: true,
            // "before the combat damage step" — legal through the declare-
            // blockers step at the latest (CR 508–510).
            activationPhaseRestriction: [
                "BEGINNING_OF_COMBAT",
                "DECLARE_ATTACKERS",
                "DECLARE_BLOCKERS",
            ],
            resolve: (ctx: SpellContext) => ctx.preventAllCombatDamage(),
        },
    ],
};

// Boris Devilboon — "{2}{B}{R}, {T}: Create a 1/1 black and red Demon creature
// token named Minor Demon." (CR 602 activated ability + CR 111 token
// creation.)
export const borisDevilboon: CardDefinition = {
    id: "82ae30e8-2dcd-46b8-925b-cc24e11fb95d",
    name: "Boris Devilboon",
    oracleText:
        "{2}{B}{R}, {T}: Create a 1/1 black and red Demon creature token named Minor Demon.",
    manaCost: { X: 3, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Zombie", "Wizard"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "boris-devilboon-minor-demon",
            oracleText:
                "{2}{B}{R}, {T}: Create a 1/1 black and red Demon creature token named Minor Demon.",
            cost: { mana: { X: 2, B: 1, R: 1 }, tap: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(
                    {
                        name: "Minor Demon",
                        types: ["Creature"],
                        subtypes: ["Demon"],
                        power: 1,
                        toughness: 1,
                        colors: ["B", "R"],
                    },
                    ctx.controller
                );
            },
        },
    ],
};

// Gwendlyn Di Corci — "{T}: Target player discards a card at random. Activate
// only during your turn." (CR 602.5b turn restriction + CR 701.8a random
// discard.)
export const gwendlynDiCorci: CardDefinition = {
    id: "473d70b6-a88c-49f4-9415-19919c4468ae",
    name: "Gwendlyn Di Corci",
    oracleText:
        "{T}: Target player discards a card at random. Activate only during your turn.",
    manaCost: { X: 1, U: 1, B: 2, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Rogue"],
    power: 3,
    toughness: 5,
    activatedAbilities: [
        {
            id: "gwendlyn-di-corci-discard",
            oracleText:
                "{T}: Target player discards a card at random. Activate only during your turn.",
            cost: { tap: true },
            useStack: true,
            controllerTurnOnly: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "player") {
                    ctx.discardAtRandom(target.id, 1);
                }
            },
        },
    ],
};

// Kei Takahashi — "{T}: Prevent the next 2 damage that would be dealt to target
// creature this turn." (CR 602 tap ability + CR 615 prevent-N shield on a
// chosen target.)
export const keiTakahashi: CardDefinition = {
    id: "6a4a524a-fdc7-432d-994b-953808528349",
    name: "Kei Takahashi",
    oracleText:
        "{T}: Prevent the next 2 damage that would be dealt to target creature this turn.",
    manaCost: { X: 2, G: 1, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "kei-takahashi-prevent",
            oracleText:
                "{T}: Prevent the next 2 damage that would be dealt to target creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.preventNextNDamageToTarget(target, 2, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Pavel Maliki — "{B}{R}: Pavel Maliki gets +1/+0 until end of turn." (CR 611.1
// repeatable temporary buff.)
export const pavelMaliki: CardDefinition = {
    id: "304f9d39-3ea2-4274-b23e-e4eaabbc1c4b",
    name: "Pavel Maliki",
    oracleText: "{B}{R}: Pavel Maliki gets +1/+0 until end of turn.",
    manaCost: { X: 4, B: 1, R: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 5,
    toughness: 3,
    activatedAbilities: [
        {
            id: "pavel-maliki-pump",
            oracleText: "{B}{R}: Pavel Maliki gets +1/+0 until end of turn.",
            cost: { mana: { B: 1, R: 1 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.addTemporaryPTBuff(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    0,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Ragnar — "{G}{W}{U}, {T}: Regenerate target creature." (CR 602 tap ability +
// CR 701.15a regeneration shield on a chosen target.)
export const ragnar: CardDefinition = {
    id: "2cf6a3a3-4a06-4eb7-981a-b70cf05b2473",
    name: "Ragnar",
    oracleText: "{G}{W}{U}, {T}: Regenerate target creature.",
    manaCost: { G: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Cleric"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "ragnar-regenerate",
            oracleText: "{G}{W}{U}, {T}: Regenerate target creature.",
            cost: { mana: { G: 1, W: 1, U: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.applyRegenerationShield(target);
                }
            },
        },
    ],
};

// Tuknir Deathlock — Flying (CR 702.9) + "{R}{G}, {T}: Target creature gets
// +2/+2 until end of turn." (CR 611.1 buff on a chosen target.)
export const tuknirDeathlock: CardDefinition = {
    id: "9dfbcb4d-a9ae-4d76-8dde-7312fbad56b0",
    name: "Tuknir Deathlock",
    oracleText:
        "Flying\n{R}{G}, {T}: Target creature gets +2/+2 until end of turn.",
    manaCost: { X: 0, R: 2, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Wizard"],
    power: 2,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "tuknir-deathlock-pump",
            oracleText:
                "{R}{G}, {T}: Target creature gets +2/+2 until end of turn.",
            cost: { mana: { R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 2, 2, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

// Xira Arien — Flying (CR 702.9) + "{B}{R}{G}, {T}: Target player draws a
// card." (CR 602 tap ability + CR 121.1 draw.)
export const xiraArien: CardDefinition = {
    id: "cc6c7d89-32e7-4c3f-ac90-7db3a46eed4b",
    name: "Xira Arien",
    oracleText: "Flying\n{B}{R}{G}, {T}: Target player draws a card.",
    manaCost: { B: 1, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Insect", "Wizard"],
    power: 1,
    toughness: 2,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "xira-arien-draw",
            oracleText: "{B}{R}{G}, {T}: Target player draws a card.",
            cost: { mana: { B: 1, R: 1, G: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "player") {
                    ctx.drawCards(target.id, 1);
                }
            },
        },
    ],
};

// --- Mana abilities (CR 605.1a — useStack: false, resolve immediately) ------

// Princess Lucrezia — "{T}: Add {U}." (CR 605.1a mana ability.)
export const princessLucrezia: CardDefinition = {
    id: "a1dcf48c-2700-4024-807e-9244e4c649ac",
    name: "Princess Lucrezia",
    oracleText: "{T}: Add {U}.",
    manaCost: { X: 3, U: 2, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Wizard"],
    power: 5,
    toughness: 4,
    activatedAbilities: [
        {
            id: "princess-lucrezia-mana",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaProduced: { U: 1 },
        },
    ],
};

// Riven Turnbull — "{T}: Add {B}." (CR 605.1a mana ability.)
export const rivenTurnbull: CardDefinition = {
    id: "d11f90e7-ced1-4d80-8083-99acbf459ad7",
    name: "Riven Turnbull",
    oracleText: "{T}: Add {B}.",
    manaCost: { X: 5, U: 1, B: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Advisor"],
    power: 5,
    toughness: 7,
    activatedAbilities: [
        {
            id: "riven-turnbull-mana",
            oracleText: "{T}: Add {B}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ B: 1 }),
            manaProduced: { B: 1 },
        },
    ],
};

// Sunastian Falconer — "{T}: Add {C}{C}." (CR 605.1a mana ability.)
export const sunastianFalconer: CardDefinition = {
    id: "587075f3-a568-4089-83ca-fe1e473c025d",
    name: "Sunastian Falconer",
    oracleText: "{T}: Add {C}{C}.",
    manaCost: { X: 3, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Shaman"],
    power: 4,
    toughness: 4,
    activatedAbilities: [
        {
            id: "sunastian-falconer-mana",
            oracleText: "{T}: Add {C}{C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 2 }),
            manaProduced: { C: 2 },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts, lands & colorless free tranche (#377) — every artifact, land, and
// colorless Legends card expressible TODAY with existing primitives (keywords,
// staticEffects / layer system, trigger factories, prevention shields,
// activated / mana abilities, SpellContext methods). Data + resolve() closures
// only; zero engine change (ADR 0014). Legendary artifacts/lands ship carrying
// the `Legendary` supertype as data and become fully correct once the legend-
// rule SBA (#369 C1) lands. Source: MTGJSON LEG.json, modern Oracle text
// (ADR 0004).
//
// Cards owned by feature clusters (#369 C1–C9) are NOT here:
//   • C4 bands-with-other grant-lands: Adventurers' Guildhouse, Cathedral of
//     Serra, Mountain Stronghold, Seafarer's Quay, Unholy Citadel; and the
//     banding strip Tolaria.
//   • C5 named counters: Triassic Egg (hatchling counters), Voodoo Doll (pin
//     counters), Serpent Generator (poison-counter token).
//   • C7 upkeep pay-or-sacrifice: Forethought Amulet, The Tabernacle at Pendrell
//     Vale.
//
// SKIPPED here — needs an engine primitive that genuinely isn't built yet
// (data-only tranche must not build engine support); each lands in a later
// batch when its primitive ships:
//   • Hammerheim, Urborg — "target creature loses all landwalk / loses first
//     strike or swampwalk until end of turn" needs a duration-scoped keyword
//     REMOVAL; only static keyword-remove and keyword GRANT exist (same gap
//     flagged for Radjan Spirit).
//   • Karakas — "Return target legendary creature" needs a supertype target
//     filter; TargetRequirement has no `supertypeFilter`.
//   • Arena of the Ancients — "Legendary creatures don't untap" needs a
//     supertype-scoped untap-restriction; PermanentFilter has no supertypes
//     field.
//   • Al-abara's Carpet — "prevent all damage to you by attacking creatures
//     without flying" needs an attacker-flying-filtered player damage shield;
//     no primitive (Island Sanctuary is an attack restriction, not prevention).
//   • Horn of Deafening, Kry Shield — "prevent all damage that would be dealt
//     BY target creature" needs a per-source by-only prevention; only the
//     to-AND-by shield and global Fog exist (same gap flagged for Subdue).
//   • Marble Priest — "all Walls able to block this do so" + Wall-filtered
//     damage prevention has no clean primitive.
//   • Nova Pentacle — redirect player-damage onto a creature; no redirect-to-
//     creature shield kind exists (the shields redirect to a player).
//   • Bronze Horse — "prevent all damage by spells that target this, while you
//     control another creature" needs a conditional spell-damage prevention
//     guard; permanent-guard covers targeting/destroy, not damage.
//   • Sentinel — "change base toughness to 1 + target's power, indefinitely"
//     needs an indefinite base-P/T set; only phase-scoped setBasePT exists
//     (same gap flagged for Wood Elemental).
//   • North Star — "spend mana as though any type for one spell" needs a
//     one-shot any→any mana substitution; only static single-pair from→to
//     mana-substitution exists.
//   • Ring of Immortals — "counter a spell that targets a permanent you
//     control" needs a target-of-the-spell predicate not exposed to
//     TargetRequirement.
//   • Sword of the Ages — "Sacrifice any number of creatures" as a cost needs a
//     variable multi-sacrifice activation cost; only single sacrificeFilter
//     exists.
//   • Gauntlets of Chaos — two-target type-matched control exchange + aura
//     destruction; deferred to keep this batch low-risk.
//   • Knowledge Vault — "return all cards exiled with this artifact to hand /
//     graveyard" needs exile-by-source tracking with non-battlefield return;
//     returnExiledForSource returns to the battlefield only.
//   • Life Chisel — gain life equal to the SACRIFICED creature's toughness; the
//     sacrifice cost snapshots mana value only, not toughness.
//   • Life Matrix — grants an INDEFINITE activated ability to a creature;
//     grantAbility is phase-scoped only.
// ─────────────────────────────────────────────────────────────────────────────

// --- Cost-reduction artifacts (CR 601.2f — cost-modifier static) ----------

// Mana Matrix — "Instant and enchantment spells you cast cost {2} less."
// Generic-only reduction (CR 601.2f) scoped to the controller via the spell's
// controllerId matching the artifact's controllerId.
export const manaMatrix: CardDefinition = {
    id: "a3eedc11-0b47-430c-8391-577a2d05c2ae",
    name: "Mana Matrix",
    oracleText:
        "Instant and enchantment spells you cast cost {2} less to cast.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (
                card: PermanentView,
                _ctx: StaticEffectContext,
                effectSource?: PermanentView
            ) =>
                card.controllerId === effectSource?.controllerId &&
                (card.types.includes("Instant") ||
                    card.types.includes("Enchantment")),
            costReduction: { X: 2 },
        },
    ],
};

// Planar Gate — "Creature spells you cast cost {2} less to cast."
export const planarGate: CardDefinition = {
    id: "dd27f0fe-c032-4f61-9f3d-98a6d2e2c426",
    name: "Planar Gate",
    oracleText: "Creature spells you cast cost {2} less to cast.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (
                card: PermanentView,
                _ctx: StaticEffectContext,
                effectSource?: PermanentView
            ) =>
                card.controllerId === effectSource?.controllerId &&
                card.types.includes("Creature"),
            costReduction: { X: 2 },
        },
    ],
};

// --- Utility artifacts (CR 602 activated abilities) -----------------------

// Relic Barrier — "{T}: Tap target artifact." (CR 701.20 tap.)
export const relicBarrier: CardDefinition = {
    id: "c062cbae-ce5e-43be-9932-c81a0a3622e8",
    name: "Relic Barrier",
    oracleText: "{T}: Tap target artifact.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "relic-barrier-tap",
            oracleText: "{T}: Tap target artifact.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.tap(target);
            },
        },
    ],
};

// Alchor's Tomb — "{2}, {T}: Target permanent you control becomes the color of
// your choice. (This effect lasts indefinitely.)" (CR 105.2, 611 color-set via
// indefinite setColorOverride; the color is a player option choice.)
export const alchorsTomb: CardDefinition = {
    id: "f4395b19-2118-4a09-8932-f9ce9bc54d6d",
    name: "Alchor's Tomb",
    oracleText:
        "{2}, {T}: Target permanent you control becomes the color of your choice. (This effect lasts indefinitely.)",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "alchors-tomb-color",
            oracleText:
                "{2}, {T}: Target permanent you control becomes the color of your choice.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "any",
                count: 1,
                controller: "you",
            },
            resolveSteps: [
                (ctx: SpellContext) => {
                    const target = ctx.targets[0];
                    if (target?.type !== "permanent") return;
                    const pick = ctx.requestOptionChoice({
                        playerId: ctx.controller,
                        choiceId: "alchors-tomb-color",
                        prompt: "Choose a color.",
                        options: [
                            { id: "W", label: "White" },
                            { id: "U", label: "Blue" },
                            { id: "B", label: "Black" },
                            { id: "R", label: "Red" },
                            { id: "G", label: "Green" },
                        ],
                    });
                    if (pick === undefined) return; // suspended
                    ctx.setColorOverride(target, [pick as "W"]);
                },
            ],
        },
    ],
};

// Mirror Universe — "{T}, Sacrifice Mirror Universe: Exchange life totals with
// target opponent. Activate only during your upkeep." (CR 118.5 life exchange,
// modeled as gain/loss deltas since there is no setLife primitive.)
export const mirrorUniverse: CardDefinition = {
    id: "a8f05d5e-bb7d-4554-b880-f0c6b4688357",
    name: "Mirror Universe",
    oracleText:
        "{T}, Sacrifice Mirror Universe: Exchange life totals with target opponent. Activate only during your upkeep.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "mirror-universe-exchange",
            oracleText:
                "{T}, Sacrifice Mirror Universe: Exchange life totals with target opponent. Activate only during your upkeep.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "player") return;
                const mine = ctx.getLife(ctx.controller);
                const theirs = ctx.getLife(target.id);
                const delta = mine - theirs;
                if (delta > 0) {
                    ctx.loseLife(ctx.controller, delta);
                    ctx.gainLife(target.id, delta);
                } else if (delta < 0) {
                    ctx.gainLife(ctx.controller, -delta);
                    ctx.loseLife(target.id, -delta);
                }
            },
        },
    ],
};

// --- Legendary lands (CR 305 land + 205.4a Legendary supertype) -----------

// Pendelhaven — Legendary land. "{T}: Add {G}." + "{T}: Target 1/1 creature gets
// +1/+2 until end of turn." (CR 605.1a mana ability; CR 611.1 temp P/T buff
// gated by a 1/1 power+toughness filter.)
export const pendelhaven: CardDefinition = {
    id: "79427109-c1f3-476d-a029-0049217237b5",
    name: "Pendelhaven",
    oracleText:
        "{T}: Add {G}.\n{T}: Target 1/1 creature gets +1/+2 until end of turn.",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "pendelhaven-mana",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaProduced: { G: 1 },
        },
        {
            id: "pendelhaven-pump",
            oracleText:
                "{T}: Target 1/1 creature gets +1/+2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { min: 1, max: 1 },
                toughnessFilter: { min: 1, max: 1 },
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.addTemporaryPTBuff(target, 1, 2, { phase: "end-of-turn" });
            },
        },
    ],
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

// Aerathi Berserker — {2}{R}{R}{R} 2/4, Rampage 3.
export const aerathiBerserker: CardDefinition = {
    id: "06673800-22a7-4ee3-92fa-7c7cd4865d30",
    name: "Aerathi Berserker",
    oracleText:
        "Rampage 3 (Whenever this creature becomes blocked, it gets +3/+3 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 2, R: 3 },
    types: ["Creature"],
    subtypes: ["Human", "Berserker"],
    power: 2,
    toughness: 4,
    staticAbilities: ["rampage 3"],
    triggeredAbilities: [rampageTrigger(3)],
};

// Frost Giant — {3}{R}{R}{R} 4/4, Rampage 2.
export const frostGiant: CardDefinition = {
    id: "6955d54f-7b37-4e43-8183-51677fb1ee11",
    name: "Frost Giant",
    oracleText:
        "Rampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, R: 3 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 4,
    toughness: 4,
    staticAbilities: ["rampage 2"],
    triggeredAbilities: [rampageTrigger(2)],
};

// Craw Giant — {3}{G}{G}{G}{G} 6/4, Trample, Rampage 2.
export const crawGiant: CardDefinition = {
    id: "707dadf0-735f-445d-9240-e49660913314",
    name: "Craw Giant",
    oracleText:
        "Trample\nRampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, G: 4 },
    types: ["Creature"],
    subtypes: ["Giant"],
    power: 6,
    toughness: 4,
    staticAbilities: ["trample", "rampage 2"],
    triggeredAbilities: [rampageTrigger(2)],
};

// Wolverine Pack — {2}{G}{G} 2/4, Rampage 2.
export const wolverinePack: CardDefinition = {
    id: "ba5aee52-095e-4c69-93eb-5adac11ed1fc",
    name: "Wolverine Pack",
    oracleText:
        "Rampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Wolverine"],
    power: 2,
    toughness: 4,
    staticAbilities: ["rampage 2"],
    triggeredAbilities: [rampageTrigger(2)],
};

// Chromium — {2}{W}{W}{U}{U}{B}{B} 7/7, Flying, Rampage 2. Elder Dragon Legend.
// Rampage + Flying shipped with C3 (#380); the C7 (#383) upkeep "sacrifice
// unless you pay {W}{U}{B}" maintenance cost is wired here via
// `payOrSacrificeUpkeepTrigger` (see the C7 section at the foot of this file).
export const chromium: CardDefinition = {
    id: "8cd7d7e1-f928-4429-9a59-ba0590a78e98",
    name: "Chromium",
    oracleText:
        "Flying\nRampage 2 (Whenever this creature becomes blocked, it gets +2/+2 until end of turn for each creature blocking it beyond the first.)\nAt the beginning of your upkeep, sacrifice Chromium unless you pay {W}{U}{B}.",
    manaCost: { X: 2, W: 2, U: 2, B: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying", "rampage 2"],
    triggeredAbilities: [
        rampageTrigger(2),
        payOrSacrificeUpkeepTrigger({
            id: "chromium-upkeep",
            cardName: "Chromium",
            cost: { W: 1, U: 1, B: 1 },
            costText: "{W}{U}{B}",
        }),
    ],
};

// Hunding Gjornersen — {3}{W}{U}{U} 5/4, Rampage 1. Legendary.
export const hundingGjornersen: CardDefinition = {
    id: "07d8e501-6857-4a52-a3b9-2bf0bee5b08c",
    name: "Hunding Gjornersen",
    oracleText:
        "Rampage 1 (Whenever this creature becomes blocked, it gets +1/+1 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, W: 1, U: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Warrior"],
    power: 5,
    toughness: 4,
    staticAbilities: ["rampage 1"],
    triggeredAbilities: [rampageTrigger(1)],
};

// Marhault Elsdragon — {3}{R}{R}{G} 4/6, Rampage 1. Legendary.
export const marhaultElsdragon: CardDefinition = {
    id: "67330004-6720-46d9-9de0-c79230110583",
    name: "Marhault Elsdragon",
    oracleText:
        "Rampage 1 (Whenever this creature becomes blocked, it gets +1/+1 until end of turn for each creature blocking it beyond the first.)",
    manaCost: { X: 3, R: 2, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elf", "Warrior"],
    power: 4,
    toughness: 6,
    staticAbilities: ["rampage 1"],
    triggeredAbilities: [rampageTrigger(1)],
};

// ─────────────────────────────────────────────────────────────────────────────
// C4 — Bands with other [quality] (CR 702.22j, #381)
//
// The restricted banding variant. Encoded as a parametric keyword string on
// `staticAbilities` and consumed by the band-formation legality check in
// `convex/gre/banding.ts`:
//
//   "bands with other:legendary"               — "bands with other legendary creatures"
//   "bands with other:name=Wolves of the Hunt" — "bands with other creatures named …"
//
// A band is legal (CR 702.22j) when some member has "bands with other [Q]" and
// EVERY member satisfies that quality [Q]. The damage-division property of
// banding (CR 702.22j-k) also applies — `getDamageAssignerId` treats a
// bands-with-other creature exactly like a plain-banding one.
//
// Scope of #381: band-FORMATION eligibility + the damage-assignment authority,
// reusing the shipped banding engine (block-as-a-group and damage division were
// already built for plain banding). No new attacking-band primitives.
//
// The five grant-lands publish the keyword onto color-matched legendary
// creatures their controller controls via a filtered `keyword-grant` static
// effect (continuous, CR 611). Master of the Hunt mints same-named Wolf tokens
// carrying the name-quality keyword. Shelkin Brownie and Tolaria strip the
// ability until end of turn via the duration-scoped `removeStaticAbilities`
// primitive (Tolaria also strips plain banding).
// ─────────────────────────────────────────────────────────────────────────────

/** Predicate factory for a grant-land: matches the controller's legendary
 *  creatures of the given color (CR 611 — "[Color] legendary creatures you
 *  control"). */
const legendaryCreatureGrant =
    (
        color: Color
    ): ((
        target: PermanentView,
        source: PermanentView,
        ctx: StaticEffectContext
    ) => boolean) =>
    (target, source, ctx) =>
        ctx.isCreature(target) &&
        target.controllerId === source.controllerId &&
        ctx.hasSupertype(target, "Legendary") &&
        ctx.getColors(target).includes(color);

// Adventurers' Guildhouse — "Green legendary creatures you control have 'bands
// with other legendary creatures.'" (CR 702.22j via keyword-grant.)
export const adventurersGuildhouse: CardDefinition = {
    id: "32865e68-5842-4f17-b2ea-4ffa743b511f",
    name: "Adventurers' Guildhouse",
    oracleText:
        'Green legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("G"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Cathedral of Serra — White legendary creatures grant-land.
export const cathedralOfSerra: CardDefinition = {
    id: "e65356e6-0ead-49fd-b069-be1ea9b1c105",
    name: "Cathedral of Serra",
    oracleText:
        'White legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("W"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Mountain Stronghold — Red legendary creatures grant-land.
export const mountainStronghold: CardDefinition = {
    id: "314fd1d7-4bd8-4d95-b7c2-1aa6660ab88a",
    name: "Mountain Stronghold",
    oracleText:
        'Red legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("R"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Seafarer's Quay — Blue legendary creatures grant-land.
export const seafarersQuay: CardDefinition = {
    id: "66641d88-b3f0-4bcd-8d2d-29aa2de69e30",
    name: "Seafarer's Quay",
    oracleText:
        'Blue legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("U"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Unholy Citadel — Black legendary creatures grant-land.
export const unholyCitadel: CardDefinition = {
    id: "9de534ff-fb48-4692-bd0f-dd237ca28502",
    name: "Unholy Citadel",
    oracleText:
        'Black legendary creatures you control have "bands with other legendary creatures." (Any legendary creatures can attack in a band as long as at least one has "bands with other legendary creatures." Bands are blocked as a group. If at least two legendary creatures you control, one of which has "bands with other legendary creatures," are blocking or being blocked by the same creature, you divide that creature\'s combat damage, not its controller, among any of the creatures it\'s being blocked by or is blocking.)',
    manaCost: {},
    types: ["Land"],
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: legendaryCreatureGrant("B"),
            keyword: "bands with other:legendary",
        },
    ],
};

// Master of the Hunt — "{2}{G}{G}: Create a 1/1 green Wolf creature token named
// Wolves of the Hunt. It has 'bands with other creatures named Wolves of the
// Hunt.'" (CR 702.22j name-quality band via a token with the parametric
// keyword.) The token's name-quality keyword lets every Wolves-of-the-Hunt
// token band together (CR 702.22j: all members share the name).
export const masterOfTheHunt: CardDefinition = {
    id: "4e6bf56e-2d74-4e4d-a667-885853979377",
    name: "Master of the Hunt",
    oracleText:
        '{2}{G}{G}: Create a 1/1 green Wolf creature token named Wolves of the Hunt. It has "bands with other creatures named Wolves of the Hunt."',
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "master-of-the-hunt-wolves",
            oracleText:
                '{2}{G}{G}: Create a 1/1 green Wolf creature token named Wolves of the Hunt. It has "bands with other creatures named Wolves of the Hunt."',
            cost: { mana: { X: 2, G: 2 } },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.createToken(
                    {
                        name: "Wolves of the Hunt",
                        types: ["Creature"],
                        subtypes: ["Wolf"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                        staticAbilities: [
                            "bands with other:name=Wolves of the Hunt",
                        ],
                    },
                    ctx.controller
                );
            },
        },
    ],
};

// Shelkin Brownie — "{T}: Target creature loses all 'bands with other' abilities
// until end of turn." (CR 611.1b layer-6 duration-scoped keyword removal.)
export const shelkinBrownie: CardDefinition = {
    id: "fddcc557-871d-425b-b4ee-bc0c9bc717aa",
    name: "Shelkin Brownie",
    oracleText:
        '{T}: Target creature loses all "bands with other" abilities until end of turn.',
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Ouphe"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "shelkin-brownie-strip",
            oracleText:
                '{T}: Target creature loses all "bands with other" abilities until end of turn.',
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.removeStaticAbilities(
                    target,
                    (kw) => kw.startsWith("bands with other:"),
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// Tolaria — "{T}: Add {U}." and "{T}: Target creature loses banding and all
// 'bands with other' abilities until end of turn. Activate only during any
// upkeep step." (CR 605.1a mana ability + CR 611.1b duration-scoped strip with
// a phase-restricted activation.) Legendary land.
export const tolaria: CardDefinition = {
    id: "d43c01b7-443d-4061-a934-6863d230c9b8",
    name: "Tolaria",
    oracleText:
        '{T}: Add {U}.\n{T}: Target creature loses banding and all "bands with other" abilities until end of turn. Activate only during any upkeep step.',
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "tolaria-mana",
            oracleText: "{T}: Add {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaProduced: { U: 1 },
        },
        {
            id: "tolaria-strip",
            oracleText:
                '{T}: Target creature loses banding and all "bands with other" abilities until end of turn. Activate only during any upkeep step.',
            cost: { tap: true },
            useStack: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.removeStaticAbilities(
                    target,
                    (kw) =>
                        kw === "banding" || kw.startsWith("bands with other:"),
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C6 — Shroud / "can't be the target" static (#382)
//
// CR 702.18 (Shroud): a permanent with shroud "can't be the target of spells or
// abilities" — including its controller's own (unlike hexproof, which only bars
// opponents). CR 115 governs targets; CR 113.3 distinguishes spells from
// abilities; CR 109.5 fixes a source's characteristics (types/subtypes) for the
// "Aura spells" / "spells only" variants.
//
// All variants reuse the live `permanent-guard` machinery (gre/permanentGuard.ts,
// CR 611 continuous effect): `cantBeTargeted: true` with an `applies` predicate,
// optionally narrowed by `targetSourceSubtypeFilter` (Aura) and/or
// `targetSourceMustBeSpell`. The guard is queried at both targeting gates
// (getLegalTargets — excluded from legal targets; selectTarget — server-side
// rejection), so a guarded permanent is unclickable in the UI and a hand-rolled
// target is rejected authoritatively.
// ─────────────────────────────────────────────────────────────────────────────

// Spectral Cloak — "Enchant creature\nEnchanted creature has shroud as long as
// it's untapped." (CR 702.18 shroud, conditional on the host being untapped —
// the live guard reads the host's tap state at each targeting gate, so the
// shroud blinks off the moment the creature taps.)
export const spectralCloak: CardDefinition = {
    id: "7524fd0d-a675-41d6-bc99-bd3ba336893b",
    name: "Spectral Cloak",
    oracleText:
        "Enchant creature\nEnchanted creature has shroud as long as it's untapped. (It can't be the target of spells or abilities.)",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "spectral-cloak-shroud",
            // CR 702.18 shroud (all sources, spells AND abilities) — but only
            // while the host is untapped (CR 611 live read of the host's state).
            cantBeTargeted: true,
            applies: (target, source) =>
                target.id === source.attachedTo && !target.isTapped,
        },
    ],
};

// Anti-Magic Aura — "Enchant creature\nEnchanted creature can't be the target of
// spells and can't be enchanted by other Auras." (CR 113.3 — "spells" excludes
// abilities, so a `targetSourceMustBeSpell` guard; plus a `cantBeEnchanted`
// guard, CR 303.4, blocking further Auras from attaching.)
export const antiMagicAura: CardDefinition = {
    id: "ff78eef1-efaa-4a12-bf5d-fec83c14aff8",
    name: "Anti-Magic Aura",
    oracleText:
        "Enchant creature\nEnchanted creature can't be the target of spells and can't be enchanted by other Auras.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "anti-magic-aura-no-spell-target",
            // CR 113.3 — barred from SPELLS only; abilities can still target.
            cantBeTargeted: true,
            targetSourceMustBeSpell: true,
            applies: (target, source) => target.id === source.attachedTo,
        },
        {
            kind: "permanent-guard",
            id: "anti-magic-aura-no-enchant",
            // CR 303.4 — no further Aura may be cast at / attach to the host.
            cantBeEnchanted: true,
            applies: (target, source) => target.id === source.attachedTo,
        },
    ],
};

// Bartel Runeaxe — Legendary 6/5 Giant Warrior, "Vigilance\nBartel Runeaxe can't
// be the target of Aura spells." (CR 702.18-style untargetability narrowed to
// AURA SPELLS: a self-targeting guard with `targetSourceMustBeSpell` +
// `targetSourceSubtypeFilter: ["Aura"]`, CR 109.5 / 113.3. Vigilance is a plain
// keyword, CR 702.21.)
export const bartelRuneaxe: CardDefinition = {
    id: "f1a42691-98bb-4234-9b56-085e6677f3e4",
    name: "Bartel Runeaxe",
    oracleText: "Vigilance\nBartel Runeaxe can't be the target of Aura spells.",
    manaCost: { X: 3, B: 1, R: 1, G: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Giant", "Warrior"],
    power: 6,
    toughness: 5,
    staticAbilities: ["vigilance"],
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "bartel-runeaxe-no-aura-spell",
            cantBeTargeted: true,
            // Only Aura SPELLS (CR 109.5 subtype + CR 113.3 spell-not-ability).
            // Aura abilities (rare) and non-Aura spells/abilities still hit.
            targetSourceMustBeSpell: true,
            targetSourceSubtypeFilter: ["Aura"],
            applies: (target, source) => target.id === source.id,
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C6 deferred (need an unbuilt primitive — left for a future batch):
//   • Tetsuo Umezawa — its "{U}{B}{B}{R}, {T}: Destroy target tapped or blocking
//     creature" needs a disjunctive "tapped OR blocking" target filter across
//     two different axes (tappedFilter vs combatRoleFilter, today combined as
//     AND). Same combat-target-OR gap flagged for Crimson Manticore ("attacking
//     or blocking"). Its can't-be-target-of-Aura-spells static IS expressible
//     here (identical to Bartel Runeaxe), but shipping a Tetsuo whose flagship
//     removal ability can't be cast would be partial — defer the whole card.
//   • Wall of Shadows — "Prevent all damage that would be dealt to this by
//     creatures it's blocking" is a CONTINUOUS, blocking-pair-scoped combat
//     prevention (only a turn-scoped `combatDamageImmunity` exists, no
//     per-blocking-pair continuous prevention static — same gap flagged for Wall
//     of Vapor / Feint). Its "can't be the target of spells/abilities that can
//     target only Walls" clause is also not expressible (no card in the pool
//     carries a "Walls only" target restriction, so there is nothing to match
//     against). Defer until the continuous combat-prevention primitive lands.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// C7 — Upkeep "pay-or-sacrifice" maintenance cost (#383)
//
// The Legends Elder-Dragon drawback (CR 603.6a beginning-of-upkeep trigger +
// CR 117.3a "do X unless you pay [cost]" intervening-cost pattern). At the
// beginning of the controller's upkeep a triggered ability goes on the stack;
// on resolution the controller MAY pay a cost, and if they don't (or can't),
// the permanent is sacrificed/destroyed (CR 701.16 / 701.7). Each pay-or-not
// decision is an independent trigger on the stack (CR 603.3b), so multiple
// taxed permanents resolve their choices one at a time.
//
// ZERO engine change: the whole family is expressible with the existing
// `phaseTrigger` factory + `requestMayPay` (the same pending-choice → mutation
// path Energy Flux and Junún Efreet use) + `sacrifice` / `destroy` / `dealDamage`
// primitives. The shared body lives in `payOrSacrificeUpkeepTrigger` below so
// the five Elder Dragons + The Tabernacle's granted trigger don't repeat it
// (the closure is extracted on the 2nd card per the project's helper-extraction
// rule); Cosmic Horror's destroy-and-self-damage and Mold Demon's
// sacrifice-as-cost ETB variants compose the same primitives inline.
//
// Cards shipped here:
//   • Arcades Sabboth, Chromium (trigger added above), Nicol Bolas,
//     Palladia-Mors, Vaevictis Asmadi — "sacrifice this unless you pay {C}{C}{C}".
//   • Cosmic Horror — "destroy this unless you pay {3}{B}{B}{B}. If destroyed
//     this way, it deals 7 damage to you" (destroy variant + self-damage rider).
//   • Mold Demon — "When this enters, sacrifice it unless you sacrifice two
//     Swamps" (ETB sacrifice-as-cost variant; not an upkeep trigger, but the
//     same do-X-unless-you-pay shape — CR 603.6a ETB + CR 118.3 alternate cost).
//   • The Tabernacle at Pendrell Vale — Legendary Land that GRANTS every
//     creature "At the beginning of your upkeep, destroy this creature unless
//     you pay {1}" via a `triggered-grant` static effect (CR 113.1 / 611),
//     exactly like Energy Flux grants its tax to every artifact. Each creature's
//     own controller pays at their own upkeep (CR 603.6a, `scope: "your"`).
//
// Deferred (need a primitive not yet built; documented at the section foot):
//   Elder Spawn, Forethought Amulet, Primordial Ooze, Pit Scorpion,
//   Takklemaggot — see the C7 deferred footer.
// ─────────────────────────────────────────────────────────────────────────────

/** Shared resolve body for the Elder-Dragon "sacrifice this unless you pay
 *  [cost]" upkeep trigger (CR 603.6a + CR 117.3a). Returns a `phaseTrigger`
 *  bound to the UPKEEP step in the source controller's own scope. On
 *  resolution the controller may pay `cost`; declining (or being unable to
 *  pay) sacrifices the source permanent (CR 701.16). Reused by all five Elder
 *  Dragons and — with `consequence: "destroy"` — by The Tabernacle's granted
 *  trigger. */
export function payOrSacrificeUpkeepTrigger(args: {
    id: string;
    cardName: string;
    cost: ManaCost;
    costText: string;
    /** "sacrifice" (Elder Dragons, CR 701.16) or "destroy" (Tabernacle's
     *  granted tax, CR 701.7). Defaults to "sacrifice". */
    consequence?: "sacrifice" | "destroy";
}) {
    const verb = args.consequence ?? "sacrifice";
    return phaseTrigger({
        id: args.id,
        oracleText: `At the beginning of your upkeep, ${verb} ${args.cardName} unless you pay ${args.costText}.`,
        phase: "UPKEEP",
        scope: "your",
        resolve: (ctx, _event, scopedPlayerId) => {
            // CR 117.3a — the controller may pay the cost to keep the
            // permanent; if they don't (or can't), it is sacrificed/destroyed.
            const paid = ctx.requestMayPay({
                playerId: scopedPlayerId,
                choiceId: `${args.id}-${ctx.sourceInstanceId}`,
                cost: args.cost,
                prompt: `Pay ${args.costText} or ${verb} ${args.cardName}?`,
            });
            if (paid === undefined) return; // suspended for the choice
            if (paid) return;
            if (verb === "destroy") {
                ctx.destroy({ type: "permanent", id: ctx.sourceInstanceId });
            } else {
                ctx.sacrifice(ctx.sourceInstanceId);
            }
        },
    });
}

// Arcades Sabboth — {2}{G}{G}{W}{W}{U}{U} 7/7 Elder Dragon. C7 wires its Flying
// keyword + the upkeep "sacrifice unless you pay {G}{W}{U}" tax (CR 603.6a +
// CR 117.3a). Its +0/+2 untapped-non-attacker anthem and {W} pump are
// free-tranche abilities (staticEffects / activated) owned by #369's mono /
// multicolor batch — NOT part of the C7 maintenance-cost cluster — and are
// added by that batch; the oracleText is the full card.
export const arcadesSabboth: CardDefinition = {
    id: "2c1dbc62-ceb5-4540-ae38-901e5deafc75",
    name: "Arcades Sabboth",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Arcades Sabboth unless you pay {G}{W}{U}.\nEach untapped creature you control gets +0/+2 as long as it's not attacking.\n{W}: Arcades Sabboth gets +0/+1 until end of turn.",
    manaCost: { X: 2, G: 2, W: 2, U: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "arcades-sabboth-upkeep",
            cardName: "Arcades Sabboth",
            cost: { G: 1, W: 1, U: 1 },
            costText: "{G}{W}{U}",
        }),
    ],
};

// Nicol Bolas — {2}{U}{U}{B}{B}{R}{R} 7/7 Elder Dragon. C7 wires its Flying
// keyword + the upkeep "sacrifice unless you pay {U}{B}{R}" tax (CR 603.6a +
// CR 117.3a). Its "deals damage to an opponent → that player discards their
// hand" trigger is a free-tranche ability owned by #369's batch — not part of
// the C7 maintenance-cost cluster — and is added there; oracleText is full.
export const nicolBolas: CardDefinition = {
    id: "729feb73-4581-4f9d-ba47-bece72481b86",
    name: "Nicol Bolas",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Nicol Bolas unless you pay {U}{B}{R}.\nWhenever Nicol Bolas deals damage to an opponent, that player discards their hand.",
    manaCost: { X: 2, U: 2, B: 2, R: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "nicol-bolas-upkeep",
            cardName: "Nicol Bolas",
            cost: { U: 1, B: 1, R: 1 },
            costText: "{U}{B}{R}",
        }),
    ],
};

// Palladia-Mors — {2}{R}{R}{G}{G}{W}{W} 7/7 Elder Dragon. Flying, trample +
// the C7 upkeep tax. CR 603.6a + CR 117.3a.
export const palladiaMors: CardDefinition = {
    id: "ad64874d-ce33-4e0a-bcca-723f129ef415",
    name: "Palladia-Mors",
    oracleText:
        "Flying, trample\nAt the beginning of your upkeep, sacrifice Palladia-Mors unless you pay {R}{G}{W}.",
    manaCost: { X: 2, R: 2, G: 2, W: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying", "trample"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "palladia-mors-upkeep",
            cardName: "Palladia-Mors",
            cost: { R: 1, G: 1, W: 1 },
            costText: "{R}{G}{W}",
        }),
    ],
};

// Vaevictis Asmadi — {2}{B}{B}{R}{R}{G}{G} 7/7 Elder Dragon. C7 wires its Flying
// keyword + the upkeep "sacrifice unless you pay {B}{R}{G}" tax (CR 603.6a +
// CR 117.3a). Its three single-color +1/+0 pump abilities are free-tranche
// activated abilities owned by #369's batch — not part of the C7 cluster — and
// are added there; oracleText is the full card.
export const vaevictisAsmadi: CardDefinition = {
    id: "22ea73ec-1325-4437-a23f-dcda1767c713",
    name: "Vaevictis Asmadi",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Vaevictis Asmadi unless you pay {B}{R}{G}.\n{B}: Vaevictis Asmadi gets +1/+0 until end of turn.\n{R}: Vaevictis Asmadi gets +1/+0 until end of turn.\n{G}: Vaevictis Asmadi gets +1/+0 until end of turn.",
    manaCost: { X: 2, B: 2, R: 2, G: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elder", "Dragon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "vaevictis-asmadi-upkeep",
            cardName: "Vaevictis Asmadi",
            cost: { B: 1, R: 1, G: 1 },
            costText: "{B}{R}{G}",
        }),
    ],
};

// Cosmic Horror — {3}{B}{B}{B} 7/7 Horror, First strike. Destroy-variant of the
// upkeep tax with a self-damage rider: "At the beginning of your upkeep,
// destroy this creature unless you pay {3}{B}{B}{B}. If this creature is
// destroyed this way, it deals 7 damage to you." CR 603.6a + CR 117.3a +
// CR 701.7 destroy. The self-damage only fires on the destroy branch.
export const cosmicHorror: CardDefinition = {
    id: "18bc6ac2-19e0-4765-852b-e303a5bb4040",
    name: "Cosmic Horror",
    oracleText:
        "First strike\nAt the beginning of your upkeep, destroy this creature unless you pay {3}{B}{B}{B}. If this creature is destroyed this way, it deals 7 damage to you.",
    manaCost: { X: 3, B: 3 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 7,
    toughness: 7,
    staticAbilities: ["first strike"],
    triggeredAbilities: [
        phaseTrigger({
            id: "cosmic-horror-upkeep",
            oracleText:
                "At the beginning of your upkeep, destroy this creature unless you pay {3}{B}{B}{B}. If this creature is destroyed this way, it deals 7 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `cosmic-horror-${ctx.sourceInstanceId}`,
                    cost: { X: 3, B: 3 },
                    prompt: "Pay {3}{B}{B}{B} or destroy Cosmic Horror?",
                });
                if (paid === undefined) return; // suspended
                if (paid) return;
                // CR 701.7 destroy; the 7-damage rider only fires if the
                // creature is actually destroyed this way (an indestructible
                // Cosmic Horror survives and deals no damage).
                const destroyed = ctx.destroy({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
                if (destroyed) {
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, 7);
                }
            },
        }),
    ],
};

// Mold Demon — {5}{B}{B} 6/6 Fungus Demon. ETB sacrifice-as-cost variant of the
// do-X-unless-you-pay family: "When this creature enters, sacrifice it unless
// you sacrifice two Swamps." Not an upkeep trigger, but the same shape — the
// "pay" is an alternate cost (sacrifice two Swamps, CR 118.3) rather than mana.
// CR 603.6a ETB + CR 701.16 sacrifice. Composes `requestMayPay` (the yes/no
// gate) + a `sacrifice-permanents` `requestChoice` for the Swamp cost.
export const moldDemon: CardDefinition = {
    id: "649a33aa-7eac-4161-ae1a-fcbc758abccf",
    name: "Mold Demon",
    oracleText:
        "When this creature enters, sacrifice it unless you sacrifice two Swamps.",
    manaCost: { X: 5, B: 2 },
    types: ["Creature"],
    subtypes: ["Fungus", "Demon"],
    power: 6,
    toughness: 6,
    triggeredAbilities: [
        enteredTrigger({
            id: "mold-demon-etb",
            oracleText:
                "When this creature enters, sacrifice it unless you sacrifice two Swamps.",
            scope: "self",
            resolve: (ctx) => {
                const controller = ctx.controller;
                const swampIds = ctx.getBattlefieldIds(controller, {
                    subtypes: "Swamp",
                });
                // Can't afford the cost → the only legal outcome is to
                // sacrifice Mold Demon (CR 117.3a — an unpayable "unless"
                // cost forces the consequence). No prompt with no real choice.
                if (swampIds.length < 2) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                const accept = ctx.requestMayPay({
                    playerId: controller,
                    choiceId: `mold-demon-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice two Swamps to keep Mold Demon?",
                });
                if (accept === undefined) return; // suspended
                if (!accept) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                const picked = ctx.requestChoice({
                    playerId: controller,
                    choiceId: `mold-demon-${ctx.sourceInstanceId}-swamps`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    filter: { subtypes: "Swamp" },
                    count: 2,
                    prompt: "Sacrifice two Swamps.",
                });
                if (picked === undefined) return; // suspended
                if (picked.length < 2) {
                    // Failed to pay the full cost → sacrifice Mold Demon.
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                for (const id of picked) ctx.sacrifice(id);
            },
        }),
    ],
};

/** CR 205 — true if `target` is a Creature (The Tabernacle's affected set).
 *  Reads live `types` so a permanent animated into a creature is taxed too;
 *  the set is recomputed as creatures enter/leave (CR 611). */
const IS_CREATURE: (
    target: PermanentView,
    source: PermanentView,
    ctx: StaticEffectContext
) => boolean = (target) => target.types.includes("Creature");

// The Tabernacle at Pendrell Vale — Legendary Land. "All creatures have 'At the
// beginning of your upkeep, destroy this creature unless you pay {1}.'" The
// granted upkeep tax is attached to every creature (either player's) while the
// Tabernacle is in play via a `triggered-grant` static effect (CR 113.1 / 611),
// exactly like Energy Flux taxes every artifact. Each creature's controller, at
// the start of their OWN upkeep, may pay {1} to keep it — otherwise it is
// destroyed (CR 701.7). Each creature gets its own trigger on the stack so the
// pay-or-destroy decision is independent per creature (CR 603.3b). Legendary
// land → tapping for no mana; supertype carried as data (CR 205.4a), legend
// rule applies once the C1 SBA lands.
export const theTabernacleAtPendrellVale: CardDefinition = {
    id: "64bc9b1d-5818-4d9e-b771-e49af4ff9a5c",
    name: "The Tabernacle at Pendrell Vale",
    oracleText:
        'All creatures have "At the beginning of your upkeep, destroy this creature unless you pay {1}."',
    types: ["Land"],
    supertypes: ["Legendary"],
    staticEffects: [
        // CR 113.1 / 611 — grant the upkeep tax to every creature.
        {
            kind: "triggered-grant",
            applies: IS_CREATURE,
            abilityId: "tabernacle-upkeep",
        },
    ],
    // The granted template lives here, NOT on `triggeredAbilities`, so the
    // Tabernacle itself (a Land, not a creature) never fires it.
    triggeredGrantTemplates: [
        payOrSacrificeUpkeepTrigger({
            id: "tabernacle-upkeep",
            cardName: "this creature",
            cost: { X: 1 },
            costText: "{1}",
            consequence: "destroy",
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C7 deferred — need a primitive not yet built; each lands when its primitive
// ships:
//   • Elder Spawn — "At the beginning of your upkeep, sacrifice an Island. If
//     you don't, sacrifice this and it deals 6 damage to you." The cost is a
//     sacrifice (expressible), but the else-branch chains a sacrifice AND a
//     self-damage like Cosmic Horror — shippable, but it also has an islandwalk
//     /"can't attack unless defending player controls an Island" clause owned by
//     a different cluster; deferred whole to avoid a partial card.
//   • Forethought Amulet — "If a source would deal 4 or more damage to you,
//     prevent all but 1" is a damage-prevention REPLACEMENT, not a pay-or-else
//     trigger (mis-bucketed in the free-tranche note); owned by the prevention
//     batch.
//   • Primordial Ooze — "+1/+1 counter each upkeep, then pay {X} where X is its
//     power or it doesn't attack/can't be blocked and deals damage to you" needs
//     a power-scaled {X} pay-or-else with an attack-restriction else-branch (C5
//     named-counter + variable-cost cluster).
//   • Pit Scorpion — poison counters (C5 named-counter cluster), not a
//     pay-or-sacrifice card.
//   • Takklemaggot — multi-counter Aura that hops between creatures on death and
//     pings the controller each upkeep; needs the named-counter + on-death
//     re-attach machinery (C5), not the pay-or-sacrifice pattern.
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// C5 — Named counters + counter-driven triggers (#384, CR 122).
//
// The engine already stored arbitrary named counters on a permanent
// (`CardInstanceState.counters: Record<string, number>`, CR 122.1) and exposed
// the parametric `addCounter` / `removeCounter` / `getCounterCount` primitives
// (CR 122.6) — +1/+1 and -1/-1 ride this same map and remain layer-7d P/T
// modifiers (CR 613.4d) plus the -1/-1 ⇄ +1/+1 annihilation SBA (CR 704.5q).
// This cluster adds the NAMED (non-P/T) counter cards and the upkeep cycles
// that add/remove them, all composed from existing primitives:
//   • "doesn't untap if it has a [kind] counter" = a `keyword-grant` static
//     effect granting `does-not-untap` (read by the untap step, CR 502.1)
//     gated on a counter-count predicate in `applies`.
//   • upkeep add / remove a counter = `phaseTrigger({ phase: "UPKEEP" })`.
//   • counter-gated activations = `canActivate` (CR 602.5b) / `cost.removeCounter`
//     (CR 122.6).
//   • "-0/-2 counter" = a new entry in the layer-7d P/T-counter table.
//   • "the game is a draw" (Divine Intervention) = the new `ctx.drawGame()`
//     primitive (CR 104.4a).
//   • "if ~ started the turn untapped" / "if ~ dealt damage to an opponent this
//     turn" = new turn-scoped per-instance flags (CR 502.1 / 120.3).
//
// Deferred (need a primitive owned by another cluster — documented at the end
// of this section): Glyph of Delusion, All Hallow's Eve, plus the C7-noted
// Pit Scorpion / Takklemaggot.
// ═════════════════════════════════════════════════════════════════════════════

// Spirit Shackle — {B}{B} Aura. "Whenever enchanted creature becomes tapped,
// put a -0/-2 counter on it." (CR 701.20a becomes-tapped trigger via the
// tapped-trigger factory; CR 122.1 / 613.4d the -0/-2 counter rides the layer-7d
// P/T pipeline, so the toughness drop is visible the moment the counter lands.)
export const spiritShackle: CardDefinition = {
    id: "a30bb266-5bd1-4998-ae94-56f0f3354167",
    name: "Spirit Shackle",
    oracleText:
        "Enchant creature\nWhenever enchanted creature becomes tapped, put a -0/-2 counter on it.",
    manaCost: { B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        tappedTrigger({
            id: "spirit-shackle-tap",
            oracleText:
                "Whenever enchanted creature becomes tapped, put a -0/-2 counter on it.",
            scope: "any",
            // CR 303.4b — only the aura's host firing matters.
            condition: (event, self) => event.permanentId === self.attachedTo,
            resolve: (ctx, _event, tapped) => {
                ctx.addCounter(
                    { type: "permanent", id: tapped.id },
                    "-0/-2",
                    1
                );
            },
        }),
    ],
};

// Venarian Gold — {X}{U}{U} Aura. ETB taps the host and puts X sleep counters
// on it; the host doesn't untap while it carries a sleep counter; at the
// controller's upkeep one sleep counter is removed. CR 122 named counters,
// CR 502.1 untap skip via a counter-gated `does-not-untap` grant, CR 603.6a
// upkeep removal. Sleep counters live on the ENCHANTED CREATURE (oracle:
// "put X sleep counters on it" / "if it has a sleep counter on it").
export const venarianGold: CardDefinition = {
    id: "11fb92c0-bb1e-463a-a6b6-887a5d0cb873",
    name: "Venarian Gold",
    oracleText:
        "Enchant creature\nWhen this Aura enters, tap enchanted creature and put X sleep counters on it.\nEnchanted creature doesn't untap during its controller's untap step if it has a sleep counter on it.\nAt the beginning of the upkeep of enchanted creature's controller, remove a sleep counter from that creature.",
    manaCost: { X: 0, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            // CR 502.1 — grant the host "does-not-untap" only while it carries
            // at least one sleep counter. The untap step reads this keyword.
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id === source.attachedTo &&
                (target.counters?.sleep ?? 0) > 0,
            keyword: "does-not-untap",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "venarian-gold-etb",
            oracleText:
                "When this Aura enters, tap enchanted creature and put X sleep counters on it.",
            scope: "self",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                const host: TargetSelection = { type: "permanent", id: hostId };
                ctx.tap(host);
                // CR 122.1 — X is the value chosen as the Aura was cast.
                const x = ctx.getX();
                if (x > 0) ctx.addCounter(host, "sleep", x);
            },
        }),
        phaseTrigger({
            id: "venarian-gold-upkeep",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, remove a sleep counter from that creature.",
            phase: "UPKEEP",
            // CR 603.6a — fires at the upkeep of the enchanted creature's
            // controller, looked up at resolve time (host-controller scope).
            scope: "host-controller",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.removeCounter(
                    { type: "permanent", id: hostId },
                    "sleep",
                    1
                );
            },
        }),
    ],
};

// Cocoon — {G} Aura ("Enchant creature you control"). ETB taps the host and
// puts three pupa counters ON THE AURA; the host doesn't untap while the Aura
// has a pupa counter; each upkeep remove a pupa counter, and if none remain to
// remove, sacrifice the Aura, put a +1/+1 counter on the host, and the host
// gains flying. CR 122 (counters on the Aura itself), CR 502.1 untap skip,
// CR 701.16 sacrifice, CR 613.1b/6 flying grant.
export const cocoon: CardDefinition = {
    id: "a82c87b1-de37-4423-a1a4-533a1d8108b2",
    name: "Cocoon",
    oracleText:
        "Enchant creature you control\nWhen this Aura enters, tap enchanted creature and put three pupa counters on this Aura.\nEnchanted creature doesn't untap during your untap step if this Aura has a pupa counter on it.\nAt the beginning of your upkeep, remove a pupa counter from this Aura. If you can't, sacrifice it, put a +1/+1 counter on enchanted creature, and that creature gains flying.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    staticEffects: [
        {
            // CR 502.1 — the host doesn't untap while the AURA (source) still
            // holds a pupa counter. Predicate reads the source's counters.
            kind: "keyword-grant",
            applies: (target, source) =>
                target.id === source.attachedTo &&
                (source.counters?.pupa ?? 0) > 0,
            keyword: "does-not-untap",
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "cocoon-etb",
            oracleText:
                "When this Aura enters, tap enchanted creature and put three pupa counters on this Aura.",
            scope: "self",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (hostId) ctx.tap({ type: "permanent", id: hostId });
                // CR 122.1 — counters go on the Aura itself.
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "pupa",
                    3
                );
            },
        }),
        phaseTrigger({
            id: "cocoon-upkeep",
            oracleText:
                "At the beginning of your upkeep, remove a pupa counter from this Aura. If you can't, sacrifice it, put a +1/+1 counter on enchanted creature, and that creature gains flying.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                const pupa = ctx.getCounterCount(self, "pupa");
                if (pupa > 0) {
                    ctx.removeCounter(self, "pupa", 1);
                    return;
                }
                // CR 122.6 — "if you can't" remove a counter: hatch. Snapshot
                // the host BEFORE sacrificing the Aura (sacrifice detaches it).
                const hostId = ctx.getAttachedToId();
                ctx.sacrifice(ctx.sourceInstanceId);
                if (!hostId) return;
                const host: TargetSelection = { type: "permanent", id: hostId };
                ctx.addCounter(host, "+1/+1", 1);
                ctx.grantStaticAbilityPermanent(host, "flying");
            },
        }),
    ],
};

// Whirling Dervish — {G}{G} 1/1, protection from black. "At the beginning of
// each end step, if this creature dealt damage to an opponent this turn, put a
// +1/+1 counter on it." CR 702.16 protection, CR 603.6a end-step state-condition
// trigger (intervening-if reads the turn-scoped `dealtDamageToOpponentThisTurn`
// flag), CR 122.1 +1/+1 counter.
export const whirlingDervish: CardDefinition = {
    id: "eba294e7-7097-4bc3-b396-72e85dd4f441",
    name: "Whirling Dervish",
    oracleText:
        "Protection from black\nAt the beginning of each end step, if this creature dealt damage to an opponent this turn, put a +1/+1 counter on it.",
    manaCost: { G: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Monk"],
    power: 1,
    toughness: 1,
    staticAbilities: ["protection from black"],
    triggeredAbilities: [
        phaseTrigger({
            id: "whirling-dervish-end-step",
            oracleText:
                "At the beginning of each end step, if this creature dealt damage to an opponent this turn, put a +1/+1 counter on it.",
            phase: "END_STEP",
            scope: "each",
            // CR 603.4d — only fires if it dealt damage to an opponent this
            // turn. Re-checked at resolve (the flag persists to CLEANUP).
            interveningIf: (_event, self) =>
                self.dealtDamageToOpponentThisTurn === true,
            resolve: (ctx) => {
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        }),
    ],
};

// Primordial Ooze — {R} 1/1 Ooze that must attack. Each upkeep it grows a +1/+1
// counter; then its controller may pay {X} (X = its +1/+1 counter count) or it
// taps and deals X damage to its controller. CR 122 +1/+1 counters, CR 508.1d
// must-attack, CR 603.6a upkeep, CR 117.3a optional pay-or-else with a power-
// scaled {X} cost (X read from the live counter count).
export const primordialOoze: CardDefinition = {
    id: "a46e47e1-8639-48f7-94c4-5f9e9666839a",
    name: "Primordial Ooze",
    oracleText:
        "This creature attacks each combat if able.\nAt the beginning of your upkeep, put a +1/+1 counter on this creature. Then you may pay {X}, where X is the number of +1/+1 counters on it. If you don't, tap this creature and it deals X damage to you.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Ooze"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            // CR 508.1d — attacks each combat if able.
            kind: "attack-requirement",
            id: "primordial-ooze-attacks-if-able",
            oracleText: "This creature attacks each combat if able.",
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "primordial-ooze-upkeep",
            oracleText:
                "At the beginning of your upkeep, put a +1/+1 counter on this creature. Then you may pay {X}, where X is the number of +1/+1 counters on it. If you don't, tap this creature and it deals X damage to you.",
            phase: "UPKEEP",
            scope: "your",
            // CR 608.2 — two steps so the counter add (step 0, irreversible)
            // is NOT re-applied when the `requestMayPay` in step 1 suspends and
            // resumes. A single `resolve` would grow the Ooze twice on resume.
            resolveSteps: [
                (ctx) => {
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "+1/+1",
                        1
                    );
                },
                (ctx, scopedPlayerId) => {
                    const self: TargetSelection = {
                        type: "permanent",
                        id: ctx.sourceInstanceId,
                    };
                    const x = ctx.getCounterCount(self, "+1/+1");
                    const paid = ctx.requestMayPay({
                        playerId: scopedPlayerId,
                        choiceId: `primordial-ooze-${ctx.sourceInstanceId}`,
                        cost: { X: x },
                        prompt: `Pay {${x}} or Primordial Ooze taps and deals ${x} damage to you?`,
                    });
                    if (paid === undefined) return; // suspended
                    if (paid) return;
                    // CR 117.3a — didn't pay: tap it and it pings its controller.
                    ctx.tap(self);
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, x);
                },
            ],
        }),
    ],
};

// Rasputin Dreamweaver — {4}{W}{U} Legendary 4/1. Enters with seven dream
// counters; each removes one for {C} or to prevent 1 damage to it; each upkeep,
// if it started the turn untapped, it regains one (capped at seven). CR 122
// named counters, CR 122.6 counter-removal cost, CR 502.1 "started the turn
// untapped" flag, CR 614 damage prevention.
export const rasputinDreamweaver: CardDefinition = {
    id: "503256f8-3aab-49d0-b78b-6502aa29ce52",
    name: "Rasputin Dreamweaver",
    oracleText:
        "Rasputin Dreamweaver enters with seven dream counters on it.\nRemove a dream counter from Rasputin Dreamweaver: Add {C}.\nRemove a dream counter from Rasputin Dreamweaver: Prevent the next 1 damage that would be dealt to Rasputin Dreamweaver this turn.\nAt the beginning of your upkeep, if Rasputin Dreamweaver started the turn untapped, put a dream counter on it.\nRasputin Dreamweaver can't have more than seven dream counters on it.",
    manaCost: { X: 4, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Wizard"],
    power: 4,
    toughness: 1,
    entersWith: { counters: [{ type: "dream", count: 7 }] },
    activatedAbilities: [
        {
            id: "rasputin-dream-mana",
            cost: { removeCounter: { type: "dream", count: 1 } },
            oracleText:
                "Remove a dream counter from Rasputin Dreamweaver: Add {C}.",
            useStack: false,
            manaProduced: { C: 1 },
            effect: (ctx) => {
                ctx.addMana({ C: 1 });
            },
        },
        {
            id: "rasputin-dream-prevent",
            cost: { removeCounter: { type: "dream", count: 1 } },
            oracleText:
                "Remove a dream counter from Rasputin Dreamweaver: Prevent the next 1 damage that would be dealt to Rasputin Dreamweaver this turn.",
            useStack: true,
            resolve: (ctx) => {
                // CR 615.1 — a one-shot target-keyed prevention shield of 1 on
                // Rasputin for the rest of the turn.
                ctx.preventNextNDamageToTarget(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    1,
                    { phase: "end-of-turn" }
                );
            },
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "rasputin-upkeep-regrow",
            oracleText:
                "At the beginning of your upkeep, if Rasputin Dreamweaver started the turn untapped, put a dream counter on it.",
            phase: "UPKEEP",
            scope: "your",
            // CR 603.4d — only if it started the turn untapped.
            interveningIf: (_event, self) => self.startedTurnUntapped === true,
            resolve: (ctx) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                // CR 122 — capped at seven dream counters: no-op at the cap.
                if (ctx.getCounterCount(self, "dream") >= 7) return;
                ctx.addCounter(self, "dream", 1);
            },
        }),
    ],
};

// Divine Intervention — {6}{W}{W} Enchantment. Enters with two intervention
// counters; each upkeep removes one; when the last is removed, the game is a
// draw. CR 122 named counters, CR 104.4a game-draw via the new `ctx.drawGame()`
// primitive. The "when you remove the last counter" clause is folded into the
// upkeep resolve: removing the second counter ends the game in a draw.
export const divineIntervention: CardDefinition = {
    id: "9eae0ba1-1383-4505-b4e7-4f17dd8f20c5",
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
// C5 deferred — counter cards needing a primitive owned by another cluster:
//   • Glyph of Delusion — "target creature that target Wall blocked this turn"
//     needs a combat-history "blocked this turn" record AND a two-stage target
//     (a Wall, then a creature it blocked). The named-counter half (glyph
//     counters + does-not-untap + upkeep removal) is expressible today, but the
//     dual restricted target is a targeting feature, not a counter feature;
//     deferred whole to avoid a partial card.
//   • All Hallow's Eve — exiles ITSELF with two scream counters and ticks them
//     down from EXILE each upkeep, mass-reanimating all creatures at zero. This
//     is a suspend-like "card waits in exile with counters and an upkeep trigger
//     that functions from exile" mechanism (CR 603.6e off-battlefield trigger +
//     counters on an exiled card); the engine's exile infrastructure today is
//     the return-bundle (ADR 0028), not a counter-ticking exiled spell. Owned by
//     a future suspend/exile-counter cluster.
//   • Voodoo Doll — its named-counter core (upkeep pin accrual + end-step
//     self-destruct-and-ping) is fully expressible and shippable, but its
//     "{X}{X}, {T}: deals damage = pin count, where X is the pin count"
//     activation needs a BOARD-COMPUTED mana cost (X is forced to the live pin
//     count, not chosen by the player). The engine's `cost.mana` is static data
//     and `{ X: "X" }` is a player-chosen X; there is no dynamic/board-derived
//     cost primitive yet. Deferred whole to avoid shipping a wrong cost.
//   • Triassic Egg — hatchling-counter accrual + the two-or-more-counter
//     activation gate are C5 (expressible via `addCounter` + `canActivate`),
//     but the sacrifice ability's first mode "put a creature card from your
//     hand ONTO THE BATTLEFIELD" needs a hand→battlefield cheat primitive the
//     engine lacks (`returnToBattlefield` only covers graveyard/exile). Deferred
//     whole — owned by a future reanimation/cheat cluster.
//   • Pit Scorpion (poison counters) and Takklemaggot (multi-counter hopping
//     Aura) — noted in the C7 deferral block above; both need machinery beyond
//     plain named counters.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// C8 — Cast-tax "counter unless pay" World enchantments (#385)
//
// Two World enchantments (CR 205.4 World supertype; the world rule SBA shipped
// in C2, #379) that tax every relevant spell as it is cast: a triggered ability
// (CR 603.2 / 601.2i "whenever a player casts a spell") goes on the stack ABOVE
// the cast spell, and on resolution the spell's controller MAY pay a tax
// (CR 117.3a) — paying lets the spell remain on the stack and resolve normally,
// declining (or being unable to pay) counters it (CR 701.5a).
//
// ZERO engine change — this is the SAME composition Force Spike already uses
// (counter target spell unless its controller pays {1}), only fired from a
// SPELL_CAST trigger instead of a targeted instant:
//   spellCastTrigger (CR 601.2i) → ctx.requestMayPay (CR 117.3a, the C7
//   pending-may-pay → submitMayPay path) → ctx.counter on decline (CR 701.5a).
// No new SpellContext primitive, no new GameState field: the pay choice rides
// the existing `pendingChoices` may-pay queue, so serialization is untouched.
//
// Cards shipped here:
//   • Nether Void — "Whenever a player casts a spell, counter it unless that
//     player pays {3}." Flat {3} on every spell, any caster.
//   • In the Eye of Chaos — "Whenever a player casts an instant spell, counter
//     it unless that player pays {X}, where X is its mana value." Restricted to
//     instants; the tax is the cast spell's mana value, read at resolution from
//     the still-on-stack spell (CR 202.3 / 601.2b — getManaValue folds in the
//     chosen X), so an X spell taxes by its total cost on the stack.
//
// NOT a self-counter loop: the trigger filters by spell type, and neither
// enchantment is an instant (In the Eye of Chaos) nor — being a permanent
// already resolved onto the battlefield — on the stack when it fires.
// ─────────────────────────────────────────────────────────────────────────────

// Nether Void — {3}{B} World Enchantment. "Whenever a player casts a spell,
// counter it unless that player pays {3}." (CR 601.2i cast trigger → CR 117.3a
// may-pay billed to the spell's controller → CR 701.5a counter on decline.)
export const netherVoid: CardDefinition = {
    id: "2e72f8cb-5bc3-4711-9b7c-a6eea9a0beaf",
    name: "Nether Void",
    oracleText:
        "Whenever a player casts a spell, counter it unless that player pays {3}.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "nether-void-tax",
            oracleText:
                "Whenever a player casts a spell, counter it unless that player pays {3}.",
            scope: "any",
            resolve: (ctx, _event, spell) => {
                // CR 117.3a — the spell's controller may pay {3} to keep it;
                // declining (or being unable to pay) counters it (CR 701.5a).
                const paid = ctx.requestMayPay({
                    playerId: spell.casterId,
                    choiceId: `nether-void-pay-${spell.instanceId}`,
                    cost: { X: 3 },
                    prompt: "Pay {3} or your spell is countered (Nether Void)?",
                });
                if (paid === undefined) return; // suspended on the may-pay
                if (!paid) ctx.counter({ type: "spell", id: spell.instanceId });
            },
        }),
    ],
};

// In the Eye of Chaos — {2}{U} World Enchantment. "Whenever a player casts an
// instant spell, counter it unless that player pays {X}, where X is its mana
// value." (CR 601.2i cast trigger restricted to instants → CR 117.3a may-pay
// taxed at the cast spell's mana value → CR 701.5a counter on decline.)
export const inTheEyeOfChaos: CardDefinition = {
    id: "733933dd-c871-4f75-8b08-d7c010dddbe6",
    name: "In the Eye of Chaos",
    oracleText:
        "Whenever a player casts an instant spell, counter it unless that player pays {X}, where X is its mana value.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    supertypes: ["World"],
    triggeredAbilities: [
        spellCastTrigger({
            id: "in-the-eye-of-chaos-tax",
            oracleText:
                "Whenever a player casts an instant spell, counter it unless that player pays {X}, where X is its mana value.",
            scope: "any",
            filter: { types: ["Instant"] },
            resolve: (ctx, _event, spell) => {
                // CR 202.3 / 601.2b — the tax equals the cast spell's mana
                // value, read from the still-on-stack spell (getManaValue folds
                // in any chosen X). An MV-0 instant taxes {0}: a zero cost is
                // trivially paid, so the may-pay resolves with no real choice.
                const mv = ctx.getManaValue({
                    type: "spell",
                    id: spell.instanceId,
                });
                const paid = ctx.requestMayPay({
                    playerId: spell.casterId,
                    choiceId: `in-the-eye-of-chaos-pay-${spell.instanceId}`,
                    cost: { X: mv },
                    prompt: `Pay {${mv}} or your instant is countered (In the Eye of Chaos)?`,
                });
                if (paid === undefined) return; // suspended on the may-pay
                if (!paid) ctx.counter({ type: "spell", id: spell.instanceId });
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// C9 — Global combat caps + conditional attack restriction (#386)
//
// Two World enchantments (CR 205.4 World supertype; the world-rule SBA shipped
// in C2, #379) that reshape combat declarations GLOBALLY rather than per-card.
// Their rules can't ride a per-attacker `staticEffects[]` predicate (ADR 0006)
// because the predicate sees only one creature at a time — a count cap and a
// defender-history restriction are decisions the engine makes with full combat
// context. So the engine recognises these two cards by id (`combat.ts`:
// CAVERNS_OF_DESPAIR_ID / ARBORIA_ID) and applies the rule at declaration time:
//
//   • Caverns of Despair (CR 508.1a / 509.1a) — caps DECLARED attackers and
//     blockers at two each per combat. Enforced server-side in the
//     declareAttacker / assignBlocker mutations and in the bot's move
//     enumeration (`moves.ts`).
//   • Arboria (CR 508.1c) — a defender-history attack restriction. A player can
//     be attacked only if they cast a spell or put a NONTOKEN permanent onto
//     the battlefield during their last turn. The per-player history rides two
//     PlayerState flags (`qualifyingActionThisTurn` set by emitSpellCastEvent /
//     emitPermanentEntered, frozen into `qualifyingActionLastTurn` at
//     advanceTurn) and is read in `validateAttackerEligibility`.
//
// ZERO new SpellContext primitive: the rule is engine logic keyed off the card
// id, not a card-shaped effect. The ids below MUST match the constants in
// `convex/gre/combat.ts`.
// ─────────────────────────────────────────────────────────────────────────────

// Caverns of Despair — {2}{R}{R} World Enchantment. "No more than two creatures
// can attack each combat. No more than two creatures can block each combat."
// (CR 508.1a / 509.1a — global declaration caps; engine-enforced by id.)
export const cavernsOfDespair: CardDefinition = {
    id: "209f7479-b3a0-4c27-9602-78babb8d2e99",
    name: "Caverns of Despair",
    oracleText:
        "No more than two creatures can attack each combat.\nNo more than two creatures can block each combat.",
    manaCost: { X: 2, R: 2 },
    types: ["Enchantment"],
    supertypes: ["World"],
};

// Arboria — {2}{G}{G} World Enchantment. "Creatures can't attack a player
// unless that player cast a spell or put a nontoken permanent onto the
// battlefield during their last turn." (CR 508.1c — defender-history attack
// restriction; engine-enforced by id via per-player turn-history flags.)
export const arboria: CardDefinition = {
    id: "095078b0-0f26-442f-9d3b-45e30cdb33c4",
    name: "Arboria",
    oracleText:
        "Creatures can't attack a player unless that player cast a spell or put a nontoken permanent onto the battlefield during their last turn.",
    manaCost: { X: 2, G: 2 },
    types: ["Enchantment"],
    supertypes: ["World"],
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

// --- Mana Batteries (#482) ---------------------------------------------------
//
// The five {4} colour Mana Batteries share one shape:
//   "{2}, {T}: Put a charge counter on this artifact."
//   "{T}, Remove any number of charge counters from this artifact: Add {C}, then
//    add an additional {C} for each charge counter removed this way."
//   ({C} = the battery's colour.)
//
// The first half is an ordinary activated ability that uses the stack (CR 605 —
// it is NOT a mana ability: it adds a counter, not mana) with a {2} mana cost
// and a {T} cost; it accrues one `charge` counter per activation via
// `ctx.addCounter` (CR 122.1).
//
// The second half is a mana ability (CR 605.1a, `useStack: false` → resolves
// immediately, no stack). The player chooses N = 0..available charge counters;
// the ability removes N counters as part of its cost and produces 1 + N mana of
// the battery's colour (CR 106.1). This is expressed by reusing the existing
// board-conditional `getManaChoices` chooser (the Fellwar Stone primitive):
// each choice index N maps to "produce 1 + N mana", and the new
// `manaChoiceRemovesCounters` field tells the engine the chosen index N is also
// the number of `charge` counters to remove (CR 122.6) — keeping the cost and
// the output locked to the same single player choice. No new SpellContext
// primitive and no per-card engine code: one factory drives all five colours.
function makeManaBattery(config: {
    id: string;
    name: string;
    color: Color;
}): CardDefinition {
    const { id, name, color } = config;
    const colorLabel = `{${color}}`;
    return {
        id,
        name,
        oracleText:
            `{2}, {T}: Put a charge counter on this artifact.\n` +
            `{T}, Remove any number of charge counters from this artifact: ` +
            `Add ${colorLabel}, then add an additional ${colorLabel} for each ` +
            `charge counter removed this way.`,
        manaCost: { X: 4 },
        types: ["Artifact"],
        activatedAbilities: [
            {
                id: "mana-battery-charge",
                oracleText: "{2}, {T}: Put a charge counter on this artifact.",
                cost: { mana: { X: 2 }, tap: true },
                // CR 605: this ability adds a counter, not mana, so it uses the
                // stack like any ordinary activated ability.
                useStack: true,
                resolve: (ctx: SpellContext) => {
                    // CR 122.1 — accrue one charge counter on the source.
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "charge",
                        1
                    );
                },
            },
            {
                id: "mana-battery-tap",
                oracleText:
                    `{T}, Remove any number of charge counters from this artifact: ` +
                    `Add ${colorLabel}, then add an additional ${colorLabel} for ` +
                    `each charge counter removed this way.`,
                cost: { tap: true },
                // CR 605.1a — mana ability: resolves immediately, no stack.
                useStack: false,
                // Representative / fallback output (used by best-effort callers
                // without a board snapshot): the base one mana with no counters
                // removed. The board-conditional `getManaChoices` below is what
                // the player actually picks from.
                manaChoices: [{ [color]: 1 } as ManaCost],
                effect: (ctx) => ctx.addMana({ [color]: 1 } as ManaCost),
                // CR 106.1 / 122.6 — index N = "remove N charge counters, add
                // 1 + N mana of the battery's colour". With `available` counters
                // the chooser offers N = 0..available, i.e. 1..1+available mana.
                getManaChoices: (source) => {
                    const available = source.counters?.charge ?? 0;
                    const out: ManaCost[] = [];
                    for (let n = 0; n <= available; n++) {
                        out.push({ [color]: 1 + n } as ManaCost);
                    }
                    return out;
                },
                // The chosen index N is also the number of `charge` counters
                // removed to pay the scaling cost (CR 122.6), restored on untap.
                manaChoiceRemovesCounters: "charge",
            },
        ],
    };
}

export const blackManaBattery: CardDefinition = makeManaBattery({
    id: "d0c66e64-e357-457d-8302-b3a1fc0c56ce",
    name: "Black Mana Battery",
    color: "B",
});

export const blueManaBattery: CardDefinition = makeManaBattery({
    id: "35393661-2c53-46f0-bb33-2390d552b060",
    name: "Blue Mana Battery",
    color: "U",
});

export const greenManaBattery: CardDefinition = makeManaBattery({
    id: "4671fa01-4a9e-4cd9-8154-b0d45e11b702",
    name: "Green Mana Battery",
    color: "G",
});

export const redManaBattery: CardDefinition = makeManaBattery({
    id: "363cc5d6-70f8-4a3c-92bd-8f49774bdce2",
    name: "Red Mana Battery",
    color: "R",
});

export const whiteManaBattery: CardDefinition = makeManaBattery({
    id: "35fbbe41-d21b-4028-905f-054c44d30eb2",
    name: "White Mana Battery",
    color: "W",
});
