// Arabian Nights (ARN) — the first MTG expansion (78 unique cards). All entries
// are `Card Definition`s: ARN has no `lea` reprints, so there are no
// `Card Print` stubs to uncomment (ADR 0014). Modern Scryfall oracle text is
// authoritative (ADR 0004).
//
// This file is built in dependency-ordered batches (see PRD #171). THIS slice
// (#173, Batch 1) is the "free" cards — those expressible with existing
// primitives, keywords, and trigger factories — plus two engine extensions
// landed alongside their first consumers:
//   • the parametric `pump-combat` EffectShorthand (Army of Allah, Piety), and
//   • `isBlocking` on `PermanentFilter` (mirror of `isAttacking`).
//
// Cards whose mechanics need engine work land in their own batches and are left
// as commented back-references below. Ante / subgame cards are out of scope
// (ADR 0010). Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }).

import type { CardDefinition, SpellContext, TargetSelection } from "../types";
import { DAMAGEABLE_PERMANENT_TYPES } from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
import { untapRestriction } from "../abilities/static/untapRestriction";
import { enteredTrigger } from "../abilities/triggers/enteredTrigger";
import { diedTrigger } from "../abilities/triggers/diedTrigger";
import { damageDealtTrigger } from "../abilities/triggers/damageDealtTrigger";
import { stateTrigger } from "../abilities/triggers/stateTrigger";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla / keyword creatures (CR 702 — keywords map to `staticAbilities[]`)
// ─────────────────────────────────────────────────────────────────────────────

export const flyingMen: CardDefinition = {
    id: "25ab9a2b-e248-4ae2-aac3-b49fdb3e260a",
    name: "Flying Men",
    oracleText: "Flying",
    manaCost: { U: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 1,
    staticAbilities: ["flying"],
};

export const birdMaiden: CardDefinition = {
    id: "5c1ba0b9-db01-447f-90cc-a2fc2c24146e",
    name: "Bird Maiden",
    oracleText: "Flying",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Bird"],
    power: 1,
    toughness: 2,
    staticAbilities: ["flying"],
};

export const moorishCavalry: CardDefinition = {
    id: "f86f0781-7614-4779-a58d-f13ce96bdf33",
    name: "Moorish Cavalry",
    oracleText: "Trample",
    manaCost: { X: 2, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Knight"],
    power: 3,
    toughness: 3,
    staticAbilities: ["trample"],
};

export const stoneThrowingDevils: CardDefinition = {
    id: "d1c387dd-1347-4443-91ce-b71f7ccdceba",
    name: "Stone-Throwing Devils",
    oracleText: "First strike",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Devil"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike"],
};

export const dancingScimitar: CardDefinition = {
    id: "1eb2e494-1414-4d1f-91d2-7cb20acdb128",
    name: "Dancing Scimitar",
    oracleText: "Flying",
    manaCost: { X: 4 },
    types: ["Artifact", "Creature"],
    subtypes: ["Spirit"],
    power: 1,
    toughness: 5,
    staticAbilities: ["flying"],
};

export const repentantBlacksmith: CardDefinition = {
    id: "61fc30b6-1355-425b-a86f-18f59f83141c",
    name: "Repentant Blacksmith",
    oracleText: "Protection from red",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 1,
    toughness: 2,
    staticAbilities: ["protection from red"],
};

export const warElephant: CardDefinition = {
    id: "7416c366-95cc-4799-b6c6-34d8fad8c202",
    name: "War Elephant",
    oracleText: "Trample, banding",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 2,
    toughness: 2,
    staticAbilities: ["trample", "banding"],
};

// ─────────────────────────────────────────────────────────────────────────────
// Simple activated-ability creatures (CR 602)
// ─────────────────────────────────────────────────────────────────────────────

export const wyluliWolf: CardDefinition = {
    id: "15ccebe1-ef08-4805-a65f-a1c57abed9f2",
    name: "Wyluli Wolf",
    oracleText: "{T}: Target creature gets +1/+1 until end of turn.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Wolf"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "wyluli-wolf-pump",
            oracleText: "{T}: Target creature gets +1/+1 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.addTemporaryPTBuff(target, 1, 1, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

export const aliBaba: CardDefinition = {
    id: "29cd7064-3703-43e0-8702-d1ba13703fd8",
    name: "Ali Baba",
    oracleText: "{R}: Tap target Wall.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "ali-baba-tap-wall",
            oracleText: "{R}: Tap target Wall.",
            cost: { mana: { R: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Wall",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.tap(target);
            },
        },
    ],
};

export const kingSuleiman: CardDefinition = {
    id: "4d3dce0f-2168-4f63-b2f9-156a11beeea7",
    name: "King Suleiman",
    oracleText: "{T}: Destroy target Djinn or Efreet.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Noble"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "king-suleiman-destroy",
            oracleText: "{T}: Destroy target Djinn or Efreet.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: ["Djinn", "Efreet"],
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.destroy(target);
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Upkeep / attack / damage / death triggers (ADR 0002 trigger factories)
// ─────────────────────────────────────────────────────────────────────────────

export const juzamDjinn: CardDefinition = {
    id: "31bf3f14-b5df-498b-a1bb-965885c82401",
    name: "Juzám Djinn",
    oracleText:
        "At the beginning of your upkeep, Juzám Djinn deals 1 damage to you.",
    manaCost: { X: 2, B: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 5,
    triggeredAbilities: [
        phaseTrigger({
            id: "juzam-djinn-upkeep",
            oracleText:
                "At the beginning of your upkeep, Juzám Djinn deals 1 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                ctx.dealDamage({ type: "player", id: scopedPlayerId }, 1);
            },
        }),
    ],
};

export const serendibEfreet: CardDefinition = {
    id: "cf56e862-3169-4f63-acd0-731080fa32f2",
    name: "Serendib Efreet",
    oracleText:
        "Flying\nAt the beginning of your upkeep, Serendib Efreet deals 1 damage to you.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 4,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "serendib-efreet-upkeep",
            oracleText:
                "At the beginning of your upkeep, Serendib Efreet deals 1 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                ctx.dealDamage({ type: "player", id: scopedPlayerId }, 1);
            },
        }),
    ],
};

export const jununEfreet: CardDefinition = {
    id: "5f46783a-b91e-4829-a173-5515b09ca615",
    name: "Junún Efreet",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice Junún Efreet unless you pay {B}{B}.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "junun-efreet-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice Junún Efreet unless you pay {B}{B}.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `junun-efreet-${ctx.sourceInstanceId}`,
                    cost: { B: 2 },
                    prompt: "Pay {B}{B} or sacrifice Junún Efreet?",
                });
                if (paid === undefined) return; // suspended
                if (!paid) ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

export const serendibDjinn: CardDefinition = {
    id: "0458b733-d689-4cb5-8970-3b675c67fc4d",
    name: "Serendib Djinn",
    oracleText:
        "Flying\nAt the beginning of your upkeep, sacrifice a land. If you sacrifice an Island this way, Serendib Djinn deals 3 damage to you.\nWhen you control no lands, sacrifice Serendib Djinn.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 5,
    toughness: 6,
    staticAbilities: ["flying"],
    triggeredAbilities: [
        phaseTrigger({
            id: "serendib-djinn-upkeep",
            oracleText:
                "At the beginning of your upkeep, sacrifice a land. If you sacrifice an Island this way, Serendib Djinn deals 3 damage to you.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const lands = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Land",
                });
                if (lands.length === 0) return;
                const picks = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: `serendib-djinn-${ctx.sourceInstanceId}`,
                    kind: "sacrifice-permanents",
                    zone: "battlefield",
                    zoneOwnerId: scopedPlayerId,
                    filter: { types: "Land" },
                    count: 1,
                    prompt: "Serendib Djinn: choose a land to sacrifice.",
                });
                if (picks === undefined) return; // suspended
                const sacrificedId = picks[0];
                if (!sacrificedId) return;
                const wasIsland = ctx.hasSubtype(
                    { type: "permanent", id: sacrificedId },
                    "Island"
                );
                ctx.sacrifice(sacrificedId);
                if (wasIsland) {
                    ctx.dealDamage({ type: "player", id: scopedPlayerId }, 3);
                }
            },
        }),
        stateTrigger({
            id: "serendib-djinn-no-lands",
            oracleText: "When you control no lands, sacrifice Serendib Djinn.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.types.includes("Land")
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

export const hasranOgress: CardDefinition = {
    id: "9f310cf5-0985-4826-9779-19a713089d6d",
    name: "Hasran Ogress",
    oracleText:
        "Whenever Hasran Ogress attacks, it deals 3 damage to you unless you pay {2}.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Ogre"],
    power: 3,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "hasran-ogress-attack",
            oracleText:
                "Whenever Hasran Ogress attacks, it deals 3 damage to you unless you pay {2}.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                const paid = ctx.requestMayPay({
                    playerId: ctx.controller,
                    choiceId: `hasran-ogress-${ctx.sourceInstanceId}`,
                    cost: { X: 2 },
                    prompt: "Pay {2} or Hasran Ogress deals 3 damage to you?",
                });
                if (paid === undefined) return; // suspended
                if (!paid) {
                    ctx.dealDamage({ type: "player", id: ctx.controller }, 3);
                }
            },
        },
    ],
};

export const elHajjaj: CardDefinition = {
    id: "c4b610d3-2005-4347-bcda-c30b5b7972e5",
    name: "El-Hajjâj",
    oracleText: "Whenever El-Hajjâj deals damage, you gain that much life.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        damageDealtTrigger({
            id: "el-hajjaj-lifegain",
            oracleText:
                "Whenever El-Hajjâj deals damage, you gain that much life.",
            source: "self",
            resolve: (ctx, event) => {
                ctx.gainLife(ctx.controller, event.amount);
            },
        }),
    ],
};

export const khabalGhoul: CardDefinition = {
    id: "18607bf6-ce11-41cb-b001-0c9538406ba0",
    name: "Khabál Ghoul",
    oracleText:
        "At the beginning of each end step, put a +1/+1 counter on Khabál Ghoul for each creature that died this turn.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        phaseTrigger({
            id: "khabal-ghoul-end-step",
            oracleText:
                "At the beginning of each end step, put a +1/+1 counter on Khabál Ghoul for each creature that died this turn.",
            phase: "END_STEP",
            scope: "each",
            resolve: (ctx) => {
                const deaths = ctx.getDeathsThisTurn();
                if (deaths > 0) {
                    ctx.addCounter(
                        { type: "permanent", id: ctx.sourceInstanceId },
                        "+1/+1",
                        deaths
                    );
                }
            },
        }),
    ],
};

// Erg Raiders — end-step self-damage unless it attacked, with a
// "came under your control this turn" exemption (CR 603.4 intervening-if for
// the attack clause + CR 603.3e trigger gate for the control-change clause).
// Reuses the existing `phaseTrigger` factory (END_STEP, scope "your") and the
// `dealDamage` primitive (cf. Juzám Djinn upkeep self-damage). The exemption
// reads `self.isSummoningSick`: that flag is set when a creature enters or
// changes controller and is cleared at its controller's untap step, so it is
// true for exactly the turn the creature came under your control.
export const ergRaiders: CardDefinition = {
    id: "35c73a97-531d-4dd5-8236-39b89c183c38",
    name: "Erg Raiders",
    oracleText:
        "At the beginning of your end step, if Erg Raiders didn't attack this turn, Erg Raiders deals 2 damage to you. This ability doesn't trigger if Erg Raiders came under your control this turn.",
    manaCost: { X: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Warrior"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        phaseTrigger({
            id: "erg-raiders-end-step",
            oracleText:
                "At the beginning of your end step, if Erg Raiders didn't attack this turn, Erg Raiders deals 2 damage to you. This ability doesn't trigger if Erg Raiders came under your control this turn.",
            phase: "END_STEP",
            scope: "your",
            // CR 603.3e — the ability does not even trigger the turn Erg
            // Raiders came under your control (summoning-sick this turn).
            condition: (_event, self) => self.isSummoningSick !== true,
            // CR 603.4 intervening-if — "if it didn't attack this turn".
            // Re-checked at resolve; `hasAttackedThisTurn` persists to CLEANUP.
            interveningIf: (_event, self) => self.hasAttackedThisTurn !== true,
            resolve: (ctx, _event, scopedPlayerId) => {
                ctx.dealDamage({ type: "player", id: scopedPlayerId }, 2);
            },
        }),
    ],
};

export const rukhEgg: CardDefinition = {
    id: "b28f9e63-e5e4-44b5-a17e-8301ff17c623",
    name: "Rukh Egg",
    oracleText:
        "When Rukh Egg dies, create a 4/4 red Bird creature token with flying at the beginning of the next end step.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Bird", "Egg"],
    power: 0,
    toughness: 3,
    triggeredAbilities: [
        diedTrigger({
            id: "rukh-egg-death",
            oracleText:
                "When Rukh Egg dies, create a 4/4 red Bird creature token with flying at the beginning of the next end step.",
            scope: "self",
            resolve: (ctx) => {
                ctx.scheduleDelayedTrigger(
                    rukhEgg.id,
                    "rukh-egg-token",
                    "next-end-step",
                    { controller: ctx.controller }
                );
            },
        }),
    ],
    delayedTriggers: [
        {
            id: "rukh-egg-token",
            oracleText:
                "At the beginning of the next end step, create a 4/4 red Bird creature token with flying.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                ctx.createToken(
                    {
                        name: "Bird",
                        types: ["Creature"],
                        subtypes: ["Bird"],
                        power: 4,
                        toughness: 4,
                        colors: ["R"],
                        staticAbilities: ["flying"],
                    },
                    payload.controller,
                    1
                );
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// "Islands-matter" creatures (CR 508 attack restriction + state-trigger sac)
// ─────────────────────────────────────────────────────────────────────────────

export const dandan: CardDefinition = {
    id: "414d3cae-b8cf-4d53-bd6b-1aa83a828ba9",
    name: "Dandân",
    oracleText:
        "Dandân can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice Dandân.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Fish"],
    power: 4,
    toughness: 1,
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "dandan-island-restriction",
            oracleText:
                "Dandân can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        stateTrigger({
            id: "dandan-no-islands",
            oracleText: "When you control no Islands, sacrifice Dandân.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

export const islandFishJasconius: CardDefinition = {
    id: "8537cb0f-4821-417b-80cc-ea57d51ee9b8",
    name: "Island Fish Jasconius",
    oracleText:
        "Island Fish Jasconius doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {U}{U}{U}. If you do, untap Island Fish Jasconius.\nIsland Fish Jasconius can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice Island Fish Jasconius.",
    manaCost: { X: 4, U: 3 },
    types: ["Creature"],
    subtypes: ["Fish"],
    power: 6,
    toughness: 8,
    // `does-not-untap` keyword (read by `untapStep` in phases.ts) skips the
    // untap step for this permanent only — cleaner than a filtered
    // untap-restriction, which is for global "players skip untap" effects.
    staticAbilities: ["does-not-untap"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "island-fish-island-restriction",
            oracleText:
                "Island Fish Jasconius can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "island-fish-untap-option",
            oracleText:
                "At the beginning of your upkeep, you may pay {U}{U}{U}. If you do, untap Island Fish Jasconius.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `island-fish-${ctx.sourceInstanceId}`,
                    cost: { U: 3 },
                    prompt: "Pay {U}{U}{U} to untap Island Fish Jasconius?",
                });
                if (paid === undefined) return; // suspended
                if (paid) {
                    ctx.untap({ type: "permanent", id: ctx.sourceInstanceId });
                }
            },
        }),
        stateTrigger({
            id: "island-fish-no-islands",
            oracleText:
                "When you control no Islands, sacrifice Island Fish Jasconius.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            resolve: (ctx) => ctx.sacrifice(ctx.sourceInstanceId),
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Conditional continuous buffs (CR 613 layer 7 — staticEffects + predicate)
// ─────────────────────────────────────────────────────────────────────────────

export const kirdApe: CardDefinition = {
    id: "ebe8845e-df1c-481c-949c-aab84af99a05",
    name: "Kird Ape",
    oracleText: "Kird Ape gets +1/+2 as long as you control a Forest.",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Ape"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            // Board-conditional, so a CDA (compute reads the full state) rather
            // than a flat `pt-buff` (whose predicate can't query the battlefield).
            kind: "pt-cda",
            applies: (target, source) => target.id === source.id,
            compute: (source, state) => {
                const controlsForest = state.players.some((p) =>
                    p.battlefield.some(
                        (c) =>
                            c.controllerId === source.controllerId &&
                            c.subtypes.includes("Forest")
                    )
                );
                return controlsForest
                    ? { power: 1, toughness: 2 }
                    : { power: 0, toughness: 0 };
            },
        },
    ],
};

export const giantTortoise: CardDefinition = {
    id: "096f7ac8-c639-4347-9767-7305eaf490ba",
    name: "Giant Tortoise",
    oracleText: "Giant Tortoise gets +0/+3 as long as it's untapped.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Turtle"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) =>
                target.id === source.id && !target.isTapped,
            power: 0,
            toughness: 3,
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Auras (CR 303 — Enchant creature; static grants via AURA_AFFECTS_HOST)
// ─────────────────────────────────────────────────────────────────────────────

export const fishliverOil: CardDefinition = {
    id: "deb6ed87-aa07-4b5e-ac40-1e16dc2a817a",
    name: "Fishliver Oil",
    oracleText: "Enchant creature\nEnchanted creature has islandwalk.",
    manaCost: { X: 1, U: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: (target, source) => target.id === source.attachedTo,
            keyword: "islandwalk",
        },
    ],
};

export const unstableMutation: CardDefinition = {
    id: "a79e9236-a39e-471a-b18a-2c2ba16e7774",
    name: "Unstable Mutation",
    oracleText:
        "Enchant creature\nEnchanted creature gets +3/+3.\nAt the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.",
    manaCost: { U: 1 },
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
    triggeredAbilities: [
        phaseTrigger({
            id: "unstable-mutation-decay",
            oracleText:
                "At the beginning of the upkeep of enchanted creature's controller, put a -1/-1 counter on that creature.",
            phase: "UPKEEP",
            scope: "host-controller",
            resolve: (ctx) => {
                const hostId = ctx.getAttachedToId();
                if (hostId) {
                    ctx.addCounter(
                        { type: "permanent", id: hostId },
                        "-1/-1",
                        1
                    );
                }
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Artifacts (CR 301)
// ─────────────────────────────────────────────────────────────────────────────

export const jandorsSaddlebags: CardDefinition = {
    id: "bc4f4b92-7d4e-4b03-8cb4-e6b356c338b4",
    name: "Jandor's Saddlebags",
    oracleText: "{3}, {T}: Untap target creature.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jandors-saddlebags-untap",
            oracleText: "{3}, {T}: Untap target creature.",
            cost: { mana: { X: 3 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") ctx.untap(target);
            },
        },
    ],
};

export const flyingCarpet: CardDefinition = {
    id: "4b71ff49-ee0a-4065-9131-380468d62a30",
    name: "Flying Carpet",
    oracleText: "{2}, {T}: Target creature gains flying until end of turn.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "flying-carpet-grant",
            oracleText:
                "{2}, {T}: Target creature gains flying until end of turn.",
            cost: { mana: { X: 2 }, tap: true },
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

export const aladdinsRing: CardDefinition = {
    id: "bb2b74a2-cb74-4b54-b9c6-78c63f14cf5b",
    name: "Aladdin's Ring",
    oracleText: "{8}, {T}: Aladdin's Ring deals 4 damage to any target.",
    manaCost: { X: 8 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "aladdins-ring-bolt",
            oracleText:
                "{8}, {T}: Aladdin's Ring deals 4 damage to any target.",
            cost: { mana: { X: 8 }, tap: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target) ctx.dealDamage(target, 4);
            },
        },
    ],
};

export const jandorsRing: CardDefinition = {
    id: "71504078-a16f-4dc4-9626-0ecc42b1e93b",
    name: "Jandor's Ring",
    oracleText:
        "{2}, {T}, Discard the last card you drew this turn: Draw a card.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "jandors-ring-draw",
            oracleText:
                "{2}, {T}, Discard the last card you drew this turn: Draw a card.",
            // CR 118.3 — `discardLastDrawn` is an additional cost paid from a
            // fixed card (the last card drawn this turn). The engine validates
            // the card is still in hand and discards it at activation commit;
            // the ability is unactivatable when no such card exists.
            cost: { mana: { X: 2 }, tap: true, discardLastDrawn: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};

export const brassMan: CardDefinition = {
    id: "1a364362-e42b-415c-9d95-b6ec7139f5e7",
    name: "Brass Man",
    oracleText:
        "Brass Man doesn't untap during your untap step.\nAt the beginning of your upkeep, you may pay {1}. If you do, untap Brass Man.",
    manaCost: { X: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Construct"],
    power: 1,
    toughness: 3,
    // `does-not-untap` keyword skips the untap step for this permanent only.
    staticAbilities: ["does-not-untap"],
    triggeredAbilities: [
        phaseTrigger({
            id: "brass-man-untap-option",
            oracleText:
                "At the beginning of your upkeep, you may pay {1}. If you do, untap Brass Man.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `brass-man-${ctx.sourceInstanceId}`,
                    cost: { X: 1 },
                    prompt: "Pay {1} to untap Brass Man?",
                });
                if (paid === undefined) return; // suspended
                if (paid) {
                    ctx.untap({ type: "permanent", id: ctx.sourceInstanceId });
                }
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Instants / Sorceries
// ─────────────────────────────────────────────────────────────────────────────

export const armyOfAllah: CardDefinition = {
    id: "3d170015-b125-49a6-a15e-8fd116bbcb14",
    name: "Army of Allah",
    oracleText: "Attacking creatures get +2/+0 until end of turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Instant"],
    effect: { kind: "pump-combat", side: "attacking", power: 2, toughness: 0 },
};

export const piety: CardDefinition = {
    id: "f649c571-d7ec-4ebc-9e18-b0657cab495b",
    name: "Piety",
    oracleText: "Blocking creatures get +0/+3 until end of turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Instant"],
    effect: { kind: "pump-combat", side: "blocking", power: 0, toughness: 3 },
};

export const sandstorm: CardDefinition = {
    id: "73cba9cd-73d9-442e-bd99-9cba9f398b64",
    name: "Sandstorm",
    oracleText: "Sandstorm deals 1 damage to each attacking creature.",
    manaCost: { G: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.dealDamageToEach(1, { creatures: { isAttacking: true } });
    },
};

export const desertTwister: CardDefinition = {
    id: "0d77c149-cca2-45c7-bc83-5ba1872ad5e0",
    name: "Desert Twister",
    oracleText: "Destroy target permanent.",
    manaCost: { X: 4, G: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "any", count: 1 },
    effect: "destroy-target",
};

// ─────────────────────────────────────────────────────────────────────────────
// Lands (CR 305) — mana ability ({T}: add …) plus a second activated ability
// ─────────────────────────────────────────────────────────────────────────────

export const cityOfBrass: CardDefinition = {
    id: "f4e32327-380d-471e-813b-4c27477787ce",
    name: "City of Brass",
    oracleText:
        "Whenever City of Brass becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color.",
    types: ["Land"],
    triggeredAbilities: [
        {
            id: "city-of-brass-tap-damage",
            oracleText:
                "Whenever City of Brass becomes tapped, it deals 1 damage to you.",
            event: "PERMANENT_TAPPED",
            matches: (event, self) =>
                event.type === "PERMANENT_TAPPED" &&
                event.permanentId === self.id,
            resolve: (ctx) => {
                ctx.dealDamage({ type: "player", id: ctx.controller }, 1);
            },
        },
    ],
    activatedAbilities: [
        {
            id: "city-of-brass-mana",
            oracleText: "{T}: Add one mana of any color.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        },
    ],
};

export const elephantGraveyard: CardDefinition = {
    id: "18348df2-9037-4db4-bddb-76dc933229bf",
    name: "Elephant Graveyard",
    oracleText: "{T}: Add {C}.\n{T}: Regenerate target Elephant.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "elephant-graveyard-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "elephant-graveyard-regen",
            oracleText: "{T}: Regenerate target Elephant.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Elephant",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.applyRegenerationShield(target);
                }
            },
        },
    ],
};

export const libraryOfAlexandria: CardDefinition = {
    id: "ee266113-34ce-4189-84e7-ee2c86a2722c",
    name: "Library of Alexandria",
    oracleText:
        "{T}: Add {C}.\n{T}: Draw a card. Activate this ability only if you have exactly seven cards in hand.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "library-of-alexandria-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "library-of-alexandria-draw",
            oracleText:
                "{T}: Draw a card. Activate this ability only if you have exactly seven cards in hand.",
            cost: { tap: true },
            useStack: true,
            canActivate: (source, state) => {
                const controller = state.players.find(
                    (p) => p.id === source.controllerId
                );
                return controller?.hand.length === 7;
            },
            resolve: (ctx: SpellContext) => {
                ctx.drawCards(ctx.controller, 1);
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Batch 3 (#175) — damage prevention / replacement / destroy-replacement / reflect
// ─────────────────────────────────────────────────────────────────────────────

// Oasis — reuses the existing target-keyed prevention shield (CR 615.1). A
// nonbasic land with no mana ability, only the prevent activation.
export const oasis: CardDefinition = {
    id: "6f38565e-88b9-433d-b0e9-a3b9734f183f",
    name: "Oasis",
    oracleText:
        "{T}: Prevent the next 1 damage that would be dealt to target creature this turn.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "oasis-prevent",
            oracleText:
                "{T}: Prevent the next 1 damage that would be dealt to target creature this turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                ctx.preventNextNDamageToTarget(target, 1, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// Ali from Cairo — declarative damage replacement (CR 614): clamp any damage
// that would drop its controller's life below 1 so it lands on exactly 1.
// Fires per damage event (repeatable, CR 616.1d).
export const aliFromCairo: CardDefinition = {
    id: "42027613-d261-4ce2-8ba1-7a2480c660f8",
    name: "Ali from Cairo",
    oracleText:
        "Damage that would reduce your life total to less than 1 reduces it to 1 instead.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 0,
    toughness: 1,
    replacementEffects: [
        {
            id: "ali-from-cairo-clamp",
            oracleText:
                "Damage that would reduce your life total to less than 1 reduces it to 1 instead.",
            eventKind: "damage",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "player") return false;
                if (event.target.id !== self.controllerId) return false;
                const player = state.players.find(
                    (p) => p.id === self.controllerId
                );
                if (!player) return false;
                // Only intercept damage that would drop life below 1.
                return event.amount >= player.life;
            },
            replace: (event, ctx) => {
                if (event.kind !== "damage") return { kind: "consumed" };
                const player = ctx.state.players.find(
                    (p) => p.id === ctx.self.controllerId
                );
                const life = player?.life ?? 1;
                // Reduce the amount so the resulting life total is exactly 1.
                return {
                    kind: "modified",
                    event: { ...event, amount: Math.max(0, life - 1) },
                };
            },
        },
    ],
};

// Ebony Horse — untaps a controlled attacker and shields it from all combat
// damage both ways this turn (CR 615, per-instance transient shield).
export const ebonyHorse: CardDefinition = {
    id: "9ae81ec7-2b7d-4301-8114-032be5e6b663",
    name: "Ebony Horse",
    oracleText:
        "{2}, {T}: Untap target attacking creature you control. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
    manaCost: { X: 3 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "ebony-horse-untap",
            oracleText:
                "{2}, {T}: Untap target attacking creature you control. Prevent all combat damage that would be dealt to and dealt by that creature this turn.",
            cost: { mana: { X: 2 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                combatRoleFilter: "attacking",
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                ctx.untap(target);
                ctx.preventAllCombatDamageToAndBy(target, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// Eye for an Eye — transient reflect entry on the damageRedirections family
// (CR 614): the chosen source's next damage to you proceeds unchanged, and an
// equal amount is dealt to that source's controller.
export const eyeForAnEye: CardDefinition = {
    id: "2933ca2a-097b-44f4-ae56-ad524d26fd06",
    name: "Eye for an Eye",
    oracleText:
        "The next time a source of your choice would deal damage to you this turn, instead that source deals that much damage to you and Eye for an Eye deals that much damage to that source's controller.",
    manaCost: { W: 2 },
    types: ["Instant"],
    targetRequirement: { type: ["any", "spell"], count: 1 },
    resolve: (ctx: SpellContext) => {
        const [target] = ctx.targets;
        if (!target) return;
        // The "source of your choice" is a permanent or a spell on the stack —
        // never a player.
        if (target.type === "player") return;
        ctx.addDamageRedirectionShield({
            kind: "reflect-to-source-controller",
            sourceInstanceId: target.id,
            playerId: ctx.controller,
            remaining: 1,
            duration: { phase: "end-of-turn" },
        });
    },
};

// Pyramids — modal. The engine models `modes` only on spells, so the "Choose
// one —" is expressed as two equally-priced ({2}) single-mode activated
// abilities: behaviorally identical to picking one mode (ADR 0020). Mode 1
// destroys an Aura; mode 2 records a one-shot destroy replacement on a land.
export const pyramids: CardDefinition = {
    id: "d2e9decf-47b7-44e0-b380-8055b6011021",
    name: "Pyramids",
    oracleText:
        "{2}: Choose one —\n• Destroy target Aura attached to a land.\n• The next time target land would be destroyed this turn, remove all damage marked on it instead.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "pyramids-destroy-aura",
            oracleText: "{2}: Destroy target Aura attached to a land.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: {
                type: "Enchantment",
                subtypeFilter: "Aura",
                count: 1,
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                ctx.destroy(target);
            },
        },
        {
            id: "pyramids-save-land",
            oracleText:
                "{2}: The next time target land would be destroyed this turn, remove all damage marked on it instead.",
            cost: { mana: { X: 2 } },
            useStack: true,
            targetRequirement: { type: "Land", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target) return;
                ctx.addDestroyReplacementShield(target, {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Layer 7b set-base-P/T (CR 613.4b, ADR 0017) — Batch 2 (#174)
// ─────────────────────────────────────────────────────────────────────────────

export const singingTree: CardDefinition = {
    id: "3003bf1e-8085-45d8-882b-c449109e7631",
    name: "Singing Tree",
    oracleText:
        "{T}: Target attacking creature has base power 0 until end of turn.",
    manaCost: { X: 3, G: 1 },
    types: ["Creature"],
    subtypes: ["Plant"],
    power: 0,
    toughness: 3,
    activatedAbilities: [
        {
            id: "singing-tree-set-power",
            oracleText:
                "{T}: Target attacking creature has base power 0 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.setBasePT(target, 0, undefined, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

export const islandOfWakWak: CardDefinition = {
    id: "f09cbd18-79f1-49a0-a3bd-b380ff5ecf03",
    name: "Island of Wak-Wak",
    oracleText:
        "{T}: Target creature with flying has base power 0 until end of turn.",
    types: ["Land"],
    activatedAbilities: [
        {
            id: "island-of-wak-wak-set-power",
            oracleText:
                "{T}: Target creature with flying has base power 0 until end of turn.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                requireAbility: "flying",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.setBasePT(target, 0, undefined, {
                        phase: "end-of-turn",
                    });
                }
            },
        },
    ],
};

export const sorceressQueen: CardDefinition = {
    id: "94742003-f0f1-4483-b1a0-e7163995db1b",
    name: "Sorceress Queen",
    oracleText:
        "{T}: Target creature other than Sorceress Queen has base power and toughness 0/2 until end of turn.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "sorceress-queen-set",
            oracleText:
                "{T}: Target creature other than Sorceress Queen has base power and toughness 0/2 until end of turn.",
            cost: { tap: true },
            useStack: true,
            // Static fallback; the dynamic form excludes the source itself
            // ("a creature other than Sorceress Queen").
            targetRequirement: { type: "Creature", count: 1 },
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                excludeInstanceIds: [source.id],
            }),
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type === "permanent") {
                    ctx.setBasePT(target, 0, 2, { phase: "end-of-turn" });
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Batch 5 (#176) — activated / triggered control-gain (CR 613.1b, layer 2)
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the unique player with strictly more life than every other, or
 *  null on a tie (CR 104 "the player with the most life"). */
function uniqueMostLife(
    lives: ReadonlyArray<{ id: string; life: number }>
): string | null {
    let max = -Infinity;
    let leader: string | null = null;
    let tied = false;
    for (const { id, life } of lives) {
        if (life > max) {
            max = life;
            leader = id;
            tied = false;
        } else if (life === max) {
            tied = true;
        }
    }
    return tied ? null : leader;
}

// Aladdin — activated control change conditioned on "you control Aladdin"
// (CR 611.2b). Reverts via the conditional-control SBA when Aladdin leaves or
// changes controller.
export const aladdin: CardDefinition = {
    id: "db52bad2-a3ec-4f6f-9418-12e8c40703f6",
    name: "Aladdin",
    oracleText:
        "{1}{R}{R}, {T}: Gain control of target artifact for as long as you control Aladdin.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Rogue"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "aladdin-steal-artifact",
            oracleText:
                "{1}{R}{R}, {T}: Gain control of target artifact for as long as you control Aladdin.",
            cost: { mana: { X: 1, R: 2 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target || target.type !== "permanent") return;
                ctx.gainControl(target, ctx.controller, {
                    kind: "controller-controls-source",
                    controllerId: ctx.controller,
                });
            },
        },
    ],
};

// Old Man of the Sea — control change conditioned on "remains tapped and the
// target's power stays <= this creature's power". The "may choose not to
// untap" clause is not yet modelled (no optional-untap choice mechanism); Old
// Man therefore untaps normally and the SBA reverts control at the controller's
// next upkeep. Tracked as a follow-up.
export const oldManOfTheSea: CardDefinition = {
    id: "d10f8a05-78b0-42a7-adcd-83f6bafe5417",
    name: "Old Man of the Sea",
    oracleText:
        "You may choose not to untap this creature during your untap step.\n{T}: Gain control of target creature with power less than or equal to this creature's power for as long as this creature remains tapped and that creature's power remains less than or equal to this creature's power.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 2,
    toughness: 3,
    activatedAbilities: [
        {
            id: "old-man-of-the-sea-steal",
            oracleText:
                "{T}: Gain control of target creature with power less than or equal to this creature's power for as long as this creature remains tapped and that creature's power remains less than or equal to this creature's power.",
            cost: { tap: true },
            useStack: true,
            // Static fallback caps at the printed power; the dynamic form reads
            // the source's current power at activation.
            targetRequirement: {
                type: "Creature",
                count: 1,
                powerFilter: { max: 2 },
            },
            getTargetRequirement: (source) => ({
                type: "Creature",
                count: 1,
                powerFilter: { max: source.power ?? 0 },
            }),
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (!target || target.type !== "permanent") return;
                ctx.gainControl(target, ctx.controller, {
                    kind: "source-tapped-and-power-ge",
                });
            },
        },
    ],
};

// Ghazbán Ogre — at your upkeep, an indefinite control reassign to the unique
// most-life player (no revert condition). Intervening-if gates on a strict
// unique maximum (CR 603.4).
export const ghazbanOgre: CardDefinition = {
    id: "f9d613d5-36a2-4633-b5af-64511bb29cc2",
    name: "Ghazbán Ogre",
    oracleText:
        "At the beginning of your upkeep, if a player has more life than each other player, the player with the most life gains control of Ghazbán Ogre.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Ogre"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        phaseTrigger({
            id: "ghazban-ogre-upkeep",
            oracleText:
                "At the beginning of your upkeep, if a player has more life than each other player, the player with the most life gains control of Ghazbán Ogre.",
            phase: "UPKEEP",
            scope: "your",
            interveningIf: (_event, _self, state) =>
                !!state &&
                uniqueMostLife(
                    state.players.map((p) => ({ id: p.id, life: p.life }))
                ) !== null,
            resolve: (ctx) => {
                const leader = uniqueMostLife(
                    ctx.allPlayerIds.map((id) => ({
                        id,
                        life: ctx.getLife(id),
                    }))
                );
                if (!leader) return;
                ctx.gainControl(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    leader
                );
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Batch 6 (#177) — Deserts (desertwalk reuses landwalk; Desert-source damage
// prevention via the replacement framework, CR 614)
// ─────────────────────────────────────────────────────────────────────────────

// Desert — a nonbasic Desert land: taps for {C}, or (only at end of combat)
// pings an attacking creature. The ping's source is a Desert, so Camel /
// Desert Nomads' "prevent damage Deserts would deal" replacements catch it.
export const desert: CardDefinition = {
    id: "201155ea-f474-4e13-acda-cb071a6ca977",
    name: "Desert",
    oracleText:
        "{T}: Add {C}.\n{T}: Desert deals 1 damage to target attacking creature. Activate only during the end of combat step.",
    types: ["Land"],
    subtypes: ["Desert"],
    activatedAbilities: [
        {
            id: "desert-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "desert-ping",
            oracleText:
                "{T}: Desert deals 1 damage to target attacking creature. Activate only during the end of combat step.",
            cost: { tap: true },
            useStack: true,
            activationPhaseRestriction: ["END_OF_COMBAT"],
            targetRequirement: {
                type: "Creature",
                count: 1,
                combatRoleFilter: "attacking",
            },
            resolve: (ctx: SpellContext) => {
                const [target] = ctx.targets;
                if (target?.type === "permanent") ctx.dealDamage(target, 1);
            },
        },
    ],
};

// Desert Nomads — desertwalk (reuses the landwalk evasion machinery, keyed to
// the Desert subtype) plus a static "prevent all damage Deserts would deal to
// this creature" replacement (CR 614).
export const desertNomads: CardDefinition = {
    id: "e46d0c10-ec09-48ba-9e93-1392dca8111a",
    name: "Desert Nomads",
    oracleText:
        "Desertwalk\nPrevent all damage that would be dealt to this creature by Deserts.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Nomad"],
    power: 2,
    toughness: 2,
    staticAbilities: ["desertwalk"],
    replacementEffects: [
        {
            id: "desert-nomads-no-desert-damage",
            oracleText:
                "Prevent all damage that would be dealt to this creature by Deserts.",
            eventKind: "damage",
            appliesTo: (event, self) =>
                event.kind === "damage" &&
                event.target.type === "permanent" &&
                event.target.id === self.id &&
                !!event.sourceSubtypes?.includes("Desert"),
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

// Camel — banding, plus "as long as this creature is attacking, prevent all
// damage Deserts would deal to it and to creatures banded with it" (CR 614).
// The protected set is Camel's attacking band (or just Camel if attacking
// solo); the prevention only applies while Camel is itself an attacker.
export const camel: CardDefinition = {
    id: "e0078aa8-bfb8-43b0-a6b7-1991596c21e1",
    name: "Camel",
    oracleText:
        "Banding\nAs long as this creature is attacking, prevent all damage Deserts would deal to this creature and to creatures banded with this creature.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Camel"],
    power: 0,
    toughness: 1,
    staticAbilities: ["banding"],
    replacementEffects: [
        {
            id: "camel-band-no-desert-damage",
            oracleText:
                "As long as this creature is attacking, prevent all damage Deserts would deal to this creature and to creatures banded with this creature.",
            eventKind: "damage",
            appliesTo: (event, self, state) => {
                if (event.kind !== "damage") return false;
                if (event.target.type !== "permanent") return false;
                if (!event.sourceSubtypes?.includes("Desert")) return false;
                const combat = state.combat;
                // Camel must itself be attacking for the shield to apply.
                if (!combat || !combat.attackerIds.includes(self.id))
                    return false;
                const band = combat.bands?.find((b) =>
                    b.memberIds.includes(self.id)
                );
                const protectedIds = band ? band.memberIds : [self.id];
                return protectedIds.includes(event.target.id);
            },
            replace: () => ({ kind: "consumed" }),
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Batch 7 (#178) — scheduled pay-or-suffer effects (delayed trigger + may-pay)
// ─────────────────────────────────────────────────────────────────────────────

const NAFS_ASP_ID = "965f722c-2b18-4c22-8c30-12552def5940";

// Nafs Asp — on dealing damage to a player, schedule a delayed trigger at that
// player's NEXT DRAW STEP (new `next-draw-step` timing) offering "pay {1} or
// lose 1 life". The "before that draw step" window is modelled as a may-pay at
// the draw step itself.
export const nafsAsp: CardDefinition = {
    id: NAFS_ASP_ID,
    name: "Nafs Asp",
    oracleText:
        "Whenever this creature deals damage to a player, that player loses 1 life at the beginning of their next draw step unless they pay {1} before that draw step.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Snake"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        damageDealtTrigger({
            id: "nafs-asp-damage",
            oracleText:
                "Whenever this creature deals damage to a player, that player loses 1 life at the beginning of their next draw step unless they pay {1} before that draw step.",
            source: "self",
            target: { kind: "player", player: { relation: "any" } },
            resolve: (ctx, event) => {
                if (event.target.type !== "player") return;
                ctx.scheduleDelayedTrigger(
                    NAFS_ASP_ID,
                    "nafs-asp-draw-step",
                    "next-draw-step",
                    { playerId: event.target.id },
                    event.target.id
                );
            },
        }),
    ],
    delayedTriggers: [
        {
            id: "nafs-asp-draw-step",
            oracleText:
                "That player loses 1 life unless they paid {1} before this draw step.",
            timing: "next-draw-step",
            resolve: (ctx, payload) => {
                const pid = payload.playerId;
                if (!pid) return;
                const paid = ctx.requestMayPay({
                    playerId: pid,
                    choiceId: "nafs-asp-pay",
                    cost: { X: 1 },
                    prompt: "Pay {1} to avoid losing 1 life to Nafs Asp?",
                });
                if (paid === undefined) return; // suspended for the decision
                if (!paid) ctx.loseLife(pid, 1);
            },
        },
    ],
};

// Cyclone — upkeep: add a wind counter, then pay {G} per counter or sacrifice;
// if paid, deal (counter count) damage to each creature and player. The wind
// counter and the damage run on the resumed (committed) path so the stepped
// re-run after the may-pay suspension doesn't double-apply them.
export const cyclone: CardDefinition = {
    id: "f11684d6-5b74-47a7-a2d0-256c9e437aa6",
    name: "Cyclone",
    oracleText:
        "At the beginning of your upkeep, put a wind counter on this enchantment, then sacrifice this enchantment unless you pay {G} for each wind counter on it. If you pay, this enchantment deals damage equal to the number of wind counters on it to each creature and each player.",
    manaCost: { X: 2, G: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "cyclone-upkeep",
            oracleText:
                "At the beginning of your upkeep, put a wind counter on this enchantment, then sacrifice this enchantment unless you pay {G} for each wind counter on it. If you pay, this enchantment deals damage equal to the number of wind counters on it to each creature and each player.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // Cost basis = counters after the (not-yet-applied) increment.
                const windCount = ctx.getCounterCount(self, "wind") + 1;
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: "cyclone-pay",
                    cost: { G: windCount },
                    prompt: `Pay {G} for each wind counter (×${windCount}) or sacrifice Cyclone?`,
                });
                if (paid === undefined) return; // suspended for the decision
                // Committed path (runs once on resume).
                ctx.addCounter(self, "wind", 1);
                if (!paid) {
                    ctx.sacrifice(ctx.sourceInstanceId);
                    return;
                }
                ctx.dealDamageToEach(windCount, {
                    creatures: true,
                    players: true,
                });
            },
        }),
    ],
};

// Drop of Honey — upkeep: destroy the least-power creature (can't be
// regenerated; you choose among ties). A separate state trigger sacrifices it
// when the battlefield has no creatures.
export const dropOfHoney: CardDefinition = {
    id: "26e090d4-e7fe-403c-9aca-05c1b45ed238",
    name: "Drop of Honey",
    oracleText:
        "At the beginning of your upkeep, destroy the creature with the least power. It can't be regenerated. If two or more creatures are tied for least power, you choose one of them.\nWhen there are no creatures on the battlefield, sacrifice this enchantment.",
    manaCost: { G: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        phaseTrigger({
            id: "drop-of-honey-upkeep",
            oracleText:
                "At the beginning of your upkeep, destroy the creature with the least power. It can't be regenerated. If two or more creatures are tied for least power, you choose one of them.",
            phase: "UPKEEP",
            scope: "your",
            resolve: (ctx, _event, scopedPlayerId) => {
                const creatureIds = ctx.allPlayerIds.flatMap((pid) =>
                    ctx.getBattlefieldIds(pid, { types: "Creature" })
                );
                if (creatureIds.length === 0) return;
                const powers = creatureIds.map((id) =>
                    ctx.getPower({ type: "permanent", id })
                );
                const minPower = Math.min(...powers);
                const tied = creatureIds.filter(
                    (_id, i) => powers[i] === minPower
                );
                let victimId = tied[0];
                if (tied.length > 1) {
                    const picks = ctx.requestChoice({
                        playerId: scopedPlayerId,
                        choiceId: "drop-of-honey-tie",
                        kind: "choose-permanents",
                        zone: "battlefield",
                        candidateIds: tied,
                        count: 1,
                        prompt: "Choose a creature with the least power to destroy.",
                    });
                    if (picks === undefined) return; // suspended for the choice
                    victimId = picks[0] ?? tied[0];
                }
                ctx.destroy(
                    { type: "permanent", id: victimId },
                    { cantBeRegenerated: true }
                );
            },
        }),
        stateTrigger({
            id: "drop-of-honey-sacrifice",
            oracleText:
                "When there are no creatures on the battlefield, sacrifice this enchantment.",
            condition: (_self, state) =>
                state.players.every((p) =>
                    p.battlefield.every((c) => !c.types.includes("Creature"))
                ),
            resolve: (ctx) => {
                ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
};

// Metamorphosis (ARN) — "As an additional cost to cast this spell, sacrifice a
// creature. Add X mana of any one color, where X is 1 plus the sacrificed
// creature's mana value. Spend this mana only to cast creature spells."
//
// CR 117.9 / 601.2f: the sacrifice is an additional cost paid at announcement;
// the engine snapshots the sacrificed creature's mana value, read here via
// getAdditionalSacrificeMv(). CR 106.6: the produced mana carries a
// "creature-spell" spend restriction enforced at later spell-cast sites.
//
// "Any one color" is modelled as five modes (one per color) picked at
// announcement. CR 700.2 puts a modal choice at announcement; the printed card
// chooses the color on resolution. Choosing at announcement is a deliberate,
// invisible simplification — all five colors are always legal and nothing
// between announcement and resolution can change that — and it reuses the
// engine's existing, fully-wired modal cast flow (incl. the UI mode picker)
// instead of a bespoke resolution-time color picker.
const METAMORPHOSIS_COLORS: {
    id: string;
    color: "W" | "U" | "B" | "R" | "G";
    label: string;
}[] = [
    { id: "white", color: "W", label: "Add white mana" },
    { id: "blue", color: "U", label: "Add blue mana" },
    { id: "black", color: "B", label: "Add black mana" },
    { id: "red", color: "R", label: "Add red mana" },
    { id: "green", color: "G", label: "Add green mana" },
];

export const metamorphosis: CardDefinition = {
    id: "fbc6cfc3-b232-40bf-bc0c-4618f6f5c9a5",
    name: "Metamorphosis",
    oracleText:
        "As an additional cost to cast this spell, sacrifice a creature.\nAdd X mana of any one color, where X is 1 plus the sacrificed creature's mana value. Spend this mana only to cast creature spells.",
    manaCost: { G: 1 },
    types: ["Sorcery"],
    additionalCosts: { sacrificeFilter: { types: "Creature" } },
    modes: METAMORPHOSIS_COLORS.map((m) => ({
        id: m.id,
        label: m.label,
        oracleText:
            "Add X mana of any one color, where X is 1 plus the sacrificed creature's mana value. Spend this mana only to cast creature spells.",
        resolve: (ctx: SpellContext) => {
            // X = 1 + sacrificed creature's mana value (CR 202.3).
            const mv = ctx.getAdditionalSacrificeMv();
            if (mv === undefined) return;
            const amount = 1 + mv;
            if (amount <= 0) return;
            const cost: {
                W?: number;
                U?: number;
                B?: number;
                R?: number;
                G?: number;
            } = {};
            cost[m.color] = amount;
            ctx.addRestrictedMana(ctx.controller, cost, "creature-spell");
        },
    })),
};

// ─────────────────────────────────────────────────────────────────────────────
// Batch 8 (#179) — phasing (CR 702.26, ADR 0021)
// ─────────────────────────────────────────────────────────────────────────────

// Oubliette — modern Oracle uses phasing, not exile (ADR 0004). The ETB
// trigger phases a chosen creature (with its Auras/Equipment) out of existence
// until Oubliette leaves; `removePermanentTo`'s source-leaves hook phases it
// back in tapped. Target choice is a `choose-permanents` resolution pick over
// every battlefield (CR 702.26 deviation: modeled as a choice, not a true
// target, so protection/hexproof aren't re-checked — acceptable for the
// current pool; no new TargetRequirement.type introduced).
export const oubliette: CardDefinition = {
    id: "30d1450f-2909-410e-9920-731278fa74de",
    name: "Oubliette",
    oracleText:
        "When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way. (Auras and Equipment phase out with it. While permanents are phased out, they're treated as though they don't exist.)",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "oubliette-phase-out",
            oracleText:
                "When this enchantment enters, target creature phases out until this enchantment leaves the battlefield. Tap that creature as it phases in this way.",
            scope: "self",
            resolve: (ctx) => {
                const picks = ctx.requestChoice({
                    playerId: ctx.controller,
                    choiceId: `oubliette-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    allControllers: true,
                    filter: { types: "Creature" },
                    count: 1,
                    prompt: "Oubliette: choose a creature to phase out.",
                });
                if (picks === undefined) return; // suspended for the choice
                const creatureId = picks[0];
                if (!creatureId) return;
                ctx.phaseOut(creatureId, {
                    returnOn: {
                        kind: "source-leaves",
                        sourceId: ctx.sourceInstanceId,
                    },
                    onPhaseIn: { tap: true },
                });
            },
        }),
    ],
};

// Magnetic Mountain (ARN) — "Blue creatures don't untap during their
// controllers' untap steps. / At the beginning of each player's upkeep, that
// player may choose any number of tapped blue creatures they control and pay
// {4} for each creature chosen this way. If the player does, untap those
// creatures."
//
// CR 502.1 — the untap-step restriction is a `StaticUntapRestriction` with a
// color-scoped filter and maxUntap 0 (a hard skip of blue creatures), honored
// by the untap dispatcher for every player's untap step (scope each-player).
// CR 603.6a — the upkeep trigger fires at the beginning of EACH player's
// upkeep (scope "each"); the upkeep player is the chooser/payer. The resolve
// suspends twice (ADR 0008): a choose-any-number pick, then a may-pay scaled
// to {4} × chosen (CR 118), and on payment untaps the chosen creatures.
export const magneticMountain: CardDefinition = {
    id: "95fde48b-e40a-4183-b324-1ec276dde015",
    name: "Magnetic Mountain",
    oracleText:
        "Blue creatures don't untap during their controllers' untap steps.\nAt the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player does, untap those creatures.",
    manaCost: { X: 1, R: 2 },
    types: ["Enchantment"],
    staticEffects: [
        untapRestriction({
            id: "magnetic-mountain-no-untap",
            oracleText:
                "Blue creatures don't untap during their controllers' untap steps.",
            filter: { types: "Creature", colors: ["U"] },
            maxUntap: 0,
        }),
    ],
    triggeredAbilities: [
        phaseTrigger({
            id: "magnetic-mountain-upkeep",
            oracleText:
                "At the beginning of each player's upkeep, that player may choose any number of tapped blue creatures they control and pay {4} for each creature chosen this way. If the player does, untap those creatures.",
            phase: "UPKEEP",
            scope: "each",
            resolve: (ctx, _event, scopedPlayerId) => {
                const eligible = ctx.getBattlefieldIds(scopedPlayerId, {
                    types: "Creature",
                    colors: ["U"],
                    tapped: true,
                });
                if (eligible.length === 0) return;
                const chosen = ctx.requestChoice({
                    playerId: scopedPlayerId,
                    choiceId: `${scopedPlayerId}:mm-pick`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    filter: { types: "Creature", colors: ["U"], tapped: true },
                    count: { min: 0, max: eligible.length },
                    prompt: "Choose any number of tapped blue creatures to untap ({4} each).",
                });
                if (chosen === undefined) return; // suspend: awaiting the pick
                if (chosen.length === 0) return; // chose none — nothing to pay
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `${scopedPlayerId}:mm-pay`,
                    cost: { X: 4 * chosen.length },
                    prompt: `Pay {${4 * chosen.length}} to untap ${chosen.length} blue creature(s)?`,
                });
                if (paid === undefined) return; // suspend: awaiting the payment
                if (paid) {
                    for (const id of chosen) {
                        ctx.untap({ type: "permanent", id });
                    }
                }
            },
        }),
    ],
};

// Cuombajj Witches — "{T}: This creature deals 1 damage to any target and 1
// damage to any target of an opponent's choice." (modern oracle, ADR 0004).
//
// Two pings (CR 115.4 "any target" = creature / planeswalker / battle / player).
// The controller chooses the FIRST target at activation (the ability's normal
// `targetRequirement`, CR 602.2b). The SECOND target is "of an opponent's
// choice" (CR 601.2c / 608.2) — chosen DURING resolution by an opponent via a
// `choose-damage-target` mid-resolution choice (twin of Demonic Hordes' opponent
// pick, but over "any target" rather than a battlefield zone, so the candidate
// set spans damageable permanents AND players). The original printed text
// ("damage is inflicted simultaneously") is simplified: our engine applies the
// two pings sequentially within the single resolve step. With 1 damage each and
// no replacement interaction between the two, the observable outcome is
// identical, so the simplification is safe.
export const cuombajjWitches: CardDefinition = {
    id: "7995c3f9-a147-43c9-9f82-470924818a4c",
    name: "Cuombajj Witches",
    oracleText:
        "{T}: This creature deals 1 damage to any target and 1 damage to any target of an opponent's choice.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Wizard"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "cuombajj-witches-pings",
            oracleText:
                "{T}: This creature deals 1 damage to any target and 1 damage to any target of an opponent's choice.",
            cost: { tap: true },
            useStack: true,
            // Controller's target (CR 602.2b — chosen at activation).
            targetRequirement: { type: "any", count: 1 },
            resolve: (ctx) => {
                // The opponent's choice (CR 601.2c) suspends and resumes the
                // resolve step: on suspend `requestChoice` returns undefined,
                // on resume the WHOLE body re-runs with the stored answer. So
                // request the opponent's target FIRST and apply BOTH pings only
                // after it resolves — otherwise ping 1 would be dealt twice
                // (once before the suspend, once on resume). With no opponent
                // (solo edge) or no legal second target, ping 1 still happens.
                const own = ctx.targets[0];

                const opponentId = ctx.allPlayerIds.find(
                    (p) => p !== ctx.controller
                );
                const permanentCandidates = ctx.allPlayerIds.flatMap((pid) =>
                    ctx.getBattlefieldIds(pid, {
                        types: [...DAMAGEABLE_PERMANENT_TYPES],
                    })
                );
                const playerCandidates = [...ctx.allPlayerIds];

                // Only request the opponent's choice when there IS an opponent
                // and at least one legal target. Otherwise skip straight to the
                // controller's ping.
                let opponentTarget: TargetSelection | undefined;
                if (
                    opponentId &&
                    (permanentCandidates.length > 0 ||
                        playerCandidates.length > 0)
                ) {
                    const picked = ctx.requestChoice({
                        playerId: opponentId,
                        choiceId: `cuombajj-${ctx.sourceInstanceId}`,
                        kind: "choose-damage-target",
                        zone: "battlefield",
                        // CR 115.4 — every battlefield is a legal source of
                        // damageable permanents, so the chooser picks from all
                        // of them (the `filter` gates to the damageable types).
                        allControllers: true,
                        filter: { types: [...DAMAGEABLE_PERMANENT_TYPES] },
                        candidateIds: permanentCandidates,
                        candidatePlayerIds: playerCandidates,
                        count: 1,
                        prompt: "Cuombajj Witches: choose any target for 1 damage (opponent's choice).",
                    });
                    if (picked === undefined) return; // suspend: awaiting pick
                    const id = picked[0];
                    if (id) {
                        // Disambiguate the chosen id: a player id targets the
                        // player, otherwise a damageable permanent.
                        opponentTarget = playerCandidates.includes(id)
                            ? { type: "player", id }
                            : { type: "permanent", id };
                    }
                }

                // Both pings land now (CR 115.4 — original "simultaneously"
                // simplified to sequential; identical observable outcome for
                // 1 damage each).
                if (own) ctx.dealDamage(own, 1);
                if (opponentTarget) ctx.dealDamage(opponentTarget, 1);
            },
        },
    ],
};

// Ifh-Bíff Efreet — "Flying\n{G}: This creature deals 1 damage to each creature
// with flying and each player. Any player may activate this ability."
// (CR 113.3c — "any player may activate"; CR 120.3 mass damage). The damage
// body is identical to Hurricane's `dealDamageToEach` sweep (1 fixed instead of
// X), and the only novelty is the activation-permission flag: any player with
// priority — not just the controller — may pay {G} to fire it (game.ts gates
// the controller-only default on `ability.activatableByAnyPlayer`). The
// activator pays {G} from their own pool; the source is not tapped and stays
// under its controller's control.
export const ifhBiffEfreet: CardDefinition = {
    id: "c0b10fb7-8667-42bf-aeb6-35767a82917b",
    name: "Ifh-Bíff Efreet",
    oracleText:
        "Flying\n{G}: This creature deals 1 damage to each creature with flying and each player. Any player may activate this ability.",
    manaCost: { X: 2, G: 2 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 3,
    staticAbilities: ["flying"],
    activatedAbilities: [
        {
            id: "ifh-biff-efreet-rain",
            oracleText:
                "{G}: This creature deals 1 damage to each creature with flying and each player. Any player may activate this ability.",
            cost: { mana: { G: 1 } },
            useStack: true,
            activatableByAnyPlayer: true,
            resolve: (ctx: SpellContext) => {
                ctx.dealDamageToEach(1, {
                    creatures: { requireAbility: "flying" },
                    players: true,
                });
            },
        },
    ],
};

// Guardian Beast — "As long as Guardian Beast is untapped, noncreature
// artifacts you control can't be enchanted, can't be the targets of spells or
// abilities, have indestructible, and their control can't be changed. This
// ability doesn't remove Auras already attached." (modern oracle, ADR 0004).
//
// A single continuous protection bundle (`permanent-guard`, CR 611), evaluated
// LIVE at four gates — targeting (CR 702.16b-style), enchant (CR 303.4),
// destroy (CR 702.12), and control change (CR 613.1b). It is NOT a
// `keyword-grant`: that machinery applies/reverts on the source's
// enter/leave-the-battlefield only, so a granted keyword would go stale on a
// tap/untap transition. The `applies` predicate reads `source.isTapped` live,
// so the four protections switch off the instant Guardian Beast taps and back
// on when it untaps — correct by construction with no re-apply hook.
//
// Scope: noncreature ARTIFACTS the same controller controls (a creature that is
// also an artifact is excluded by the `!isCreature` clause). "Doesn't remove
// Auras already attached" is automatic — the enchant gate only blocks NEW
// attachment; auras already on a guarded artifact are untouched.
//
// Simplification (flagged): the printed "if something would destroy Guardian
// Beast and your artifacts simultaneously, only Guardian Beast is destroyed"
// rider is handled implicitly — our engine resolves "destroy" effects
// sequentially and the indestructible guard is read at each destroy, so a mass
// destroy that hits Guardian Beast and a guarded artifact spares the artifact
// as long as Guardian Beast has not yet left when the artifact's destroy is
// processed. Strict CR 616 simultaneous-replacement ordering is out of scope.
export const guardianBeast: CardDefinition = {
    id: "9941f83b-2903-4eab-ac6d-5313e3978fa3",
    name: "Guardian Beast",
    oracleText:
        "As long as Guardian Beast is untapped, noncreature artifacts you control can't be enchanted, can't be the targets of spells or abilities, have indestructible, and their control can't be changed. This ability doesn't remove Auras already attached.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Beast"],
    power: 2,
    toughness: 4,
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "guardian-beast-protection",
            applies: (target, source, ctx) =>
                !source.isTapped &&
                target.controllerId === source.controllerId &&
                target.types.includes("Artifact") &&
                !ctx.isCreature(target),
            cantBeTargeted: true,
            cantBeEnchanted: true,
            indestructible: true,
            controlCantChange: true,
        },
    ],
};

// Abu Ja'far — death trigger that destroys its combat partners (CR 603.2 /
// 603.10). The trigger resolves after Abu Ja'far is already in the graveyard,
// so the engine snapshots "creatures blocking or blocked by it" at the moment
// of death onto the CREATURE_DIED event (`combatPartnerIds`, computed by
// `combatPartnerIds()` in state.ts). The body re-checks each partner is still
// on the battlefield (CR 608.2b) and destroys it with `cantBeRegenerated`
// (CR 701.15c — the printed "they can't be regenerated").
export const abuJafar: CardDefinition = {
    id: "0e9ad288-d164-44a6-96ec-4185a1587f1a",
    name: "Abu Ja'far",
    oracleText:
        "When this creature dies, destroy all creatures blocking or blocked by it. They can't be regenerated.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 0,
    toughness: 1,
    triggeredAbilities: [
        diedTrigger({
            id: "abu-jafar-death",
            oracleText:
                "When this creature dies, destroy all creatures blocking or blocked by it. They can't be regenerated.",
            scope: "self",
            resolve: (ctx, _event, deadCreature) => {
                for (const partnerId of deadCreature.combatPartnerIds) {
                    ctx.destroy(
                        { type: "permanent", id: partnerId },
                        { cantBeRegenerated: true }
                    );
                }
            },
        }),
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Batch 4 (#191) — coin flip (CR 705). `ctx.flipCoin()` wraps the seeded PRNG
// (rngSeed/rngCounter) so outcomes are deterministic on replay. Mijae/Ydwen
// reuse the existing `removeFromCombat`; Ydwen reuses `becomeUnblocked` (#172)
// and the new `setCantBlockThisTurn` (twin of `setMustBlockAll`).
// ─────────────────────────────────────────────────────────────────────────────

export const bottleOfSuleiman: CardDefinition = {
    id: "c474cd6b-5610-49eb-ac98-918d900efe8b",
    name: "Bottle of Suleiman",
    oracleText:
        "{1}, Sacrifice this artifact: Flip a coin. If you win the flip, create a 5/5 colorless Djinn artifact creature token with flying. If you lose the flip, this artifact deals 5 damage to you.",
    manaCost: { X: 4 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "bottle-of-suleiman-flip",
            oracleText:
                "{1}, Sacrifice this artifact: Flip a coin. If you win the flip, create a 5/5 colorless Djinn artifact creature token with flying. If you lose the flip, this artifact deals 5 damage to you.",
            // Self-sacrifice paid at activation commit (CR 117.9); the source is
            // already off the battlefield by resolution, so the win branch
            // creates the token and the lose branch deals 5 to its controller.
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                if (ctx.flipCoin()) {
                    ctx.createToken(
                        {
                            name: "Djinn",
                            types: ["Artifact", "Creature"],
                            subtypes: ["Djinn"],
                            power: 5,
                            toughness: 5,
                            staticAbilities: ["flying"],
                        },
                        ctx.controller
                    );
                } else {
                    ctx.dealDamage({ type: "player", id: ctx.controller }, 5);
                }
            },
        },
    ],
};

export const mijaeDjinn: CardDefinition = {
    id: "d3ddbe51-cd1a-4b2c-849a-7c82d622122a",
    name: "Mijae Djinn",
    oracleText:
        "Whenever this creature attacks, flip a coin. If you lose the flip, remove this creature from combat and tap it.",
    manaCost: { R: 3 },
    types: ["Creature"],
    subtypes: ["Djinn"],
    power: 6,
    toughness: 3,
    triggeredAbilities: [
        {
            id: "mijae-djinn-attack-flip",
            oracleText:
                "Whenever this creature attacks, flip a coin. If you lose the flip, remove this creature from combat and tap it.",
            event: "ATTACKERS_DECLARED",
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            resolve: (ctx) => {
                if (ctx.flipCoin()) return; // won: stays attacking
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                ctx.removeFromCombat(self);
                ctx.tap(self);
            },
        },
    ],
};

export const ydwenEfreet: CardDefinition = {
    id: "efdba2a9-d171-45ed-8dd4-9d0046128f68",
    name: "Ydwen Efreet",
    oracleText:
        "Whenever this creature blocks, flip a coin. If you lose the flip, remove this creature from combat and it can't block this turn. Creatures it was blocking that had become blocked by only this creature this combat become unblocked.",
    manaCost: { R: 3 },
    types: ["Creature"],
    subtypes: ["Efreet"],
    power: 3,
    toughness: 6,
    triggeredAbilities: [
        {
            id: "ydwen-efreet-block-flip",
            oracleText:
                "Whenever this creature blocks, flip a coin. If you lose the flip, remove this creature from combat and it can't block this turn. Creatures it was blocking that had become blocked by only this creature this combat become unblocked.",
            // BLOCKERS_CONFIRMED fires once per attacker-blocker pair; this
            // trigger collapses to a single flip per block declaration by
            // matching only the pair whose blocker is self and whose attacker
            // is the first one Ydwen blocked (so the flip runs once even when
            // Ydwen blocks a band).
            event: "BLOCKERS_CONFIRMED",
            matches: (event, self) => {
                if (event.type !== "BLOCKERS_CONFIRMED") return false;
                return event.blockerId === self.id;
            },
            resolve: (ctx) => {
                const self: TargetSelection = {
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                };
                // Capture the attackers Ydwen is solely blocking BEFORE it
                // leaves combat: any attacker whose only blocker is Ydwen
                // becomes unblocked (CR 509.1h) and hits the defender.
                const blockersByAttacker = ctx.getBlockersByAttacker();
                if (ctx.flipCoin()) return; // won: stays blocking
                const solelyBlocked = Object.keys(blockersByAttacker).filter(
                    (attackerId) => {
                        const blockers = blockersByAttacker[attackerId];
                        return (
                            blockers.length === 1 &&
                            blockers[0] === ctx.sourceInstanceId
                        );
                    }
                );
                ctx.removeFromCombat(self);
                ctx.setCantBlockThisTurn(self);
                for (const attackerId of solelyBlocked) {
                    ctx.becomeUnblocked(attackerId);
                }
            },
        },
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Deferred to later batches — need engine work beyond existing primitives:
//
//   • Hurr Jackal — "{T}: Target creature can't be regenerated this turn"
//     needs a turn-scoped cant-be-regenerated marker primitive.
//   • Sindbad — "{T}: Draw a card and reveal it. If it isn't a land, discard
//     it" needs to inspect the just-drawn card's types from a resolve body.
//   • Erhnam Djinn — grants forestwalk "until your next upkeep"; DurationSpec
//     has no until-your-next-upkeep option yet.
//   • Diamond Valley — "{T}, Sacrifice a creature:" is a choose-another-to-
//     sacrifice activation cost, not yet modelled for activated abilities.
//   • Merchant Ship — "attacks and isn't blocked, gain 2 life" needs an
//     unblocked-attacker trigger event.
//   • Sandals of Abdallah — the "when that creature dies this turn, destroy
//     this artifact" rider needs a per-target death watch.
//   • Bazaar of Baghdad — "draw two, then discard three" draws BEFORE the
//     discard choice; activated abilities have no `resolveSteps`, so the single
//     `resolve` re-runs (and re-draws) when the discard choice suspends. Needs
//     resolveSteps support on activated abilities.
//
// Other batches (PRD #171):
//   • Batch 9 (#180-187, misc): Metamorphosis, Jihad, Magnetic Mountain,
//     Aladdin's Lamp, Cuombajj Witches, Ifh-Bíff Efreet,
//     Jandor's Ring, Erg Raiders, City in a Bottle, Aladdin's Ring
//     (charge-counter variant N/A), Flying Carpet variants N/A.
//
// Out of scope — ante / subgames depend on game modes the engine does not model
// (ADR 0010): Jeweled Bird, Ring of Ma'rûf, Shahrazad.
// ─────────────────────────────────────────────────────────────────────────────
