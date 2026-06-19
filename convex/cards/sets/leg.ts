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
} from "../types";
import { EFFECT_AFFECTS_SELF } from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { tappedTrigger } from "../abilities/triggers/tappedTrigger";
import { spellCastTrigger } from "../abilities/triggers/spellCastTrigger";
import { damageDealtTrigger } from "../abilities/triggers/damageDealtTrigger";
import { diedTrigger } from "../abilities/triggers/diedTrigger";
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
//   • C6 shroud / can't-be-targeted — Anti-Magic Aura ("can't be the target of
//     spells"), Spectral Cloak (shroud while untapped).
//   • C7 upkeep pay-or-sacrifice — Elder Spawn ("unless you sacrifice an
//     Island, sacrifice this and it deals 6 damage to you").
//   • C8 cast-tax counter-unless-pay — In the Eye of Chaos (World), Invoke
//     Prejudice (counter an opponent's off-color creature spell unless they pay
//     its mana value). Same cast-tax family — defer to C8.
//   • World rule (C2) / no continuous-reveal static — Field of Dreams ("play
//     with the top card of libraries revealed": needs a continuous top-of-
//     library reveal static that does not exist yet).
//   • No primitive yet (flagged for a future batch):
//     - Mana Drain — "add {C} at the beginning of your NEXT main phase" needs a
//       next-main-phase delayed-trigger timing (only end-step / end-of-combat /
//       draw-step exist).
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
//     - Undertow — global islandwalk negation (no evasion-negation static).
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
//     - Recall — needs a graveyard-return zone-pick kind and a cross-step
//       discarded-count carry; deferred until those primitives exist.
// ─────────────────────────────────────────────────────────────────────────────

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
//   • The Abyss → its upkeep "destroy target nonartifact creature that player
//     controls of their choice" rides the world-rule (C2) World base; deferred
//     with the rest of the World-supertype cards.
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
//     have swampwalk" needs a global landwalk-suppression static.
//   • Demonic Torment, Evil Eye of Orms-by-Gore — emit can't-attack restrictions
//     onto OTHER creatures (the source-emitted `attack-restriction` only binds
//     the creature carrying it); no other-creature attack-lock static.
//   • Wall of Putrid Flesh — its "prevent all damage dealt to this by enchanted
//     creatures" clause needs a continuous, source-filtered prevention static.
// ─────────────────────────────────────────────────────────────────────────────

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
//   • C3 Rampage — Aerathi Berserker (rampage 3), Frost Giant (rampage 2).
//   • C9 combat-cap World enchantment — Caverns of Despair ("no more than two
//     creatures can attack / block each combat").
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
//     didn't have mountainwalk" needs a global landwalk-suppression static
//     (same gap flagged for Quagmire / Undertow in earlier tranches).
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
//   • C3 Rampage — Craw Giant (rampage 2), Wolverine Pack (rampage 2).
//   • C4 bands-with-other — Master of the Hunt (Wolves-of-the-Hunt token band),
//     Shelkin Brownie ("loses all bands-with-other abilities").
//   • C5 named counters — Cocoon (pupa counters), Whirling Dervish (+1/+1
//     counter on its own combat-damage end-step trigger).
//   • World rule (C2) — Concordant Crossroads, Living Plane, Revelation. These
//     carry the World supertype; like every other World-supertype LEG card they
//     are deferred to the world-rule cluster so the supertype and its SBA ship
//     together (mirrors the blue/black/red tranches).
//   • C9 conditional attack restriction (World) — Arboria.
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
//     didn't have forestwalk" needs a global landwalk-suppression static (same
//     gap flagged for Crevasse / Quagmire / Undertow in earlier tranches).
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
//   • Sylvan Library — its draw-step "draw two extra, then pay 4 life or top-
//     deck each card drawn this turn" needs a cards-drawn-this-turn tally that
//     is not surfaced; deferred to keep this batch low-risk.
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
//     Chromium, Nicol Bolas, Palladia-Mors, Vaevictis Asmadi.
//   • Rampage N (C3): Hunding Gjornersen, Marhault Elsdragon, and Gabriel
//     Angelfire (its upkeep choice includes "rampage 3").
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
//     blocked as though they didn't have it"); no global landwalk-suppression
//     primitive (same gap flagged for Crevasse). Can't ship partial (their
//     keyword half alone isn't the printed card).
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
//   • Black/Blue/Green/Red/White Mana Battery — "{T}, Remove any number of
//     charge counters: Add 1 + N mana" needs an interactive count choice inside
//     a mana ability; immediate (useStack:false) mana abilities can't suspend
//     for a choice.
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
