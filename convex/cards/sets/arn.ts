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

import type { CardDefinition, SpellContext } from "../types";
import { phaseTrigger } from "../abilities/triggers/phaseTrigger";
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
//   • Batch 4 (#191, coin flip): Bottle of Suleiman, Mijae Djinn, Ydwen Efreet.
//   • Batch 6 (#177, deserts): Desert, Desert Nomads, Camel.
//   • Batch 7 (#178, delayed-pay): Nafs Asp, Cyclone, Drop of Honey.
//   • Batch 8 (#179, phasing): Oubliette.
//   • Batch 9 (#180-187, misc): Metamorphosis, Jihad, Magnetic Mountain,
//     Aladdin's Lamp, Cuombajj Witches, Ifh-Bíff Efreet, Guardian Beast,
//     Abu Ja'far, Jandor's Ring, Erg Raiders, City in a Bottle, Aladdin's Ring
//     (charge-counter variant N/A), Flying Carpet variants N/A.
//
// Out of scope — ante / subgames depend on game modes the engine does not model
// (ADR 0010): Jeweled Bird, Ring of Ma'rûf, Shahrazad.
// ─────────────────────────────────────────────────────────────────────────────
