// Fallen Empires (FEM), split by colour per ADR 0043. The 1994 faction-war
// expansion (102 unique cards, 187 prints across its multi-art commons). Every
// in-scope card is a new CardDefinition — FEM has zero reprints of
// already-implemented cards (ADR 0014); its signature multi-artwork commons
// ship as ONE shared CardDefinition plus one CardPrint per extra artwork, all
// setCode "fem", all resolving to the single definition. Modern Scryfall oracle
// text is authoritative (ADR 0004). Generic mana is encoded as `X: n`
// (e.g. {1}{U} → { X: 1, U: 1 }). Cards are classified by the colour identity
// of their mana cost (CR 202.2); lands and artifacts (no coloured cost) live in
// colorless.ts.

import type {
    CardDefinition,
    CardPrint,
    SpellContext,
    TokenSpec,
} from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { payOrSacrificeUpkeepTrigger } from "../leg";

const THRULL_TOKEN: TokenSpec = {
    name: "Thrull",
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 0,
    toughness: 1,
    colors: ["B"],
};

export const armorThrull: CardDefinition = {
    id: "a98384d1-8e7d-4c41-9f23-47bc2ae2ad6a", // FEM 33a (canonical art)
    rarity: "common",
    name: "Armor Thrull",
    oracleText:
        "{T}, Sacrifice this creature: Put a +1/+2 counter on target creature.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "armor-thrull-counter",
            oracleText:
                "{T}, Sacrifice this creature: Put a +1/+2 counter on target creature.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // CR 122 (issue #841) — put one +1/+2 counter on the target.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+2",
                    target: { target: 0 },
                    count: 1,
                },
            ],
        },
    ],
};

export const armorThrullFemB: CardPrint = {
    printId: "9c6120e6-ceb8-4eab-86b0-18d38ed97d8f", // FEM 33b
    definitionId: armorThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const armorThrullFemC: CardPrint = {
    printId: "18a91ed4-131e-455b-a3bd-0bd42aa754e5", // FEM 33c
    definitionId: armorThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const armorThrullFemD: CardPrint = {
    printId: "3d653ca4-c21f-4594-b900-2526a912001b", // FEM 33d
    definitionId: armorThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const basalThrull: CardDefinition = {
    id: "0c1d5d13-0160-48cb-8fac-dd86102569b4", // FEM 34a (canonical art)
    rarity: "common",
    name: "Basal Thrull",
    oracleText: "{T}, Sacrifice this creature: Add {B}{B}.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "basal-thrull-mana",
            oracleText: "{T}, Sacrifice this creature: Add {B}{B}.",
            cost: { tap: true, sacrifice: true },
            useStack: false,
            manaProduced: { B: 2 },
        },
    ],
};

export const basalThrullFemB: CardPrint = {
    printId: "fcf60db5-4f69-4db4-9dc2-1a6fbdec0429", // FEM 34b
    definitionId: basalThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const basalThrullFemC: CardPrint = {
    printId: "a86d9647-3a87-4620-aa07-26f996fc6fa3", // FEM 34c
    definitionId: basalThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const basalThrullFemD: CardPrint = {
    printId: "b6908e4c-f94d-4b0d-b9a5-64c04751f108", // FEM 34d
    definitionId: basalThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const breedingPit: CardDefinition = {
    id: "a0d7e85f-eba5-4fc5-9fc0-109109d368aa", // FEM 35
    rarity: "uncommon",
    name: "Breeding Pit",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {B}{B}.\nAt the beginning of your end step, create a 0/1 black Thrull creature token.",
    manaCost: { X: 3, B: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "breeding-pit-upkeep",
            cardName: "Breeding Pit",
            cost: { B: 2 },
            costText: "{B}{B}",
        }),
        phaseTrigger({
            id: "breeding-pit-end-step",
            phase: "END_STEP",
            scope: "your",
            oracleText:
                "At the beginning of your end step, create a 0/1 black Thrull creature token.",
            resolve: (ctx) => {
                ctx.createToken(THRULL_TOKEN, ctx.controller, 1);
            },
        }),
    ],
};

export const derelor: CardDefinition = {
    id: "9eb2b79f-f09a-49dc-8e0f-7d711ba78981", // FEM 36
    rarity: "rare",
    name: "Derelor",
    oracleText: "Black spells you cast cost {B} more to cast.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 4,
    toughness: 4,
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, ctx, effectSource) =>
                ctx.getColors(card).includes("B") &&
                effectSource !== undefined &&
                card.controllerId === effectSource.controllerId,
            costIncrease: { B: 1 },
        },
    ],
};

export const ebonPraetor: CardDefinition = {
    id: "40451f7a-692a-422d-99d3-d93a4d9315e0", // FEM 37
    rarity: "rare",
    name: "Ebon Praetor",
    oracleText:
        "First strike, trample\nAt the beginning of your upkeep, put a -2/-2 counter on this creature.\nSacrifice a creature: Remove a -2/-2 counter from this creature. If the sacrificed creature was a Thrull, put a +1/+0 counter on this creature. Activate only during your upkeep and only once each turn.",
    manaCost: { X: 4, B: 2 },
    types: ["Creature"],
    subtypes: ["Avatar", "Praetor"],
    power: 5,
    toughness: 5,
    staticAbilities: ["first strike", "trample"],
    triggeredAbilities: [
        phaseTrigger({
            id: "ebon-praetor-upkeep",
            phase: "UPKEEP",
            scope: "your",
            oracleText:
                "At the beginning of your upkeep, put a -2/-2 counter on this creature.",
            // CR 122 (issue #841) — put one -2/-2 counter on the source.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "-2/-2",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "ebon-praetor-sacrifice",
            oracleText:
                "Sacrifice a creature: Remove a -2/-2 counter from this creature. If the sacrificed creature was a Thrull, put a +1/+0 counter on this creature. Activate only during your upkeep and only once each turn.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            oncePerTurn: true,
            activationPhaseRestriction: ["UPKEEP"],
            controllerTurnOnly: true,
            // NOT DSL-migratable (ADR 0045): the `+1/+0` counter is gated on
            // whether the sacrificed creature (paid as an activation cost) was a
            // Thrull (`getAdditionalCostSubtypes`) — the `if` predicate grammar
            // reads only a bound `$paid` outcome, not a paid-cost object's
            // subtypes. Stays resolve().
            resolve: (ctx: SpellContext) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // CR 122.6 — remove a -2/-2 counter the praetor received.
                ctx.removeCounter(self, "-2/-2", 1);
                // CR 117.9 — the sacrificed creature's subtypes were snapshotted
                // when the activation cost was paid; a Thrull adds +1/+0.
                const subtypes = ctx.getAdditionalCostSubtypes();
                if (subtypes?.includes("Thrull")) {
                    ctx.addCounter(self, "+1/+0", 1);
                }
            },
        },
    ],
};

export const hymnToTourach: CardDefinition = {
    id: "eb9273ea-9a41-42e3-8c9c-0d50b127a818", // FEM 38a (canonical art)
    rarity: "common",
    name: "Hymn to Tourach",
    oracleText: "Target player discards two cards at random.",
    manaCost: { B: 2 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    resolve: (ctx: SpellContext) => {
        const target = ctx.targets[0];
        if (target?.type !== "player") return;
        ctx.discardAtRandom(target.id, 2);
    },
};

export const hymnToTourachFemB: CardPrint = {
    printId: "8601f082-7e43-44ef-97d0-dead272b7eb4", // FEM 38b
    definitionId: hymnToTourach.id,
    setCode: "fem",
    rarity: "common",
};

export const hymnToTourachFemC: CardPrint = {
    printId: "58e125c6-81dc-4907-aad2-2ccd1cb166f0", // FEM 38c
    definitionId: hymnToTourach.id,
    setCode: "fem",
    rarity: "common",
};

export const hymnToTourachFemD: CardPrint = {
    printId: "5bc50e08-dd6f-4ea7-87f8-cce72bafb928", // FEM 38d
    definitionId: hymnToTourach.id,
    setCode: "fem",
    rarity: "common",
};

const INITIATES_EBON_HAND_ID = "5be87527-3b8f-4529-afdb-a61ad4e787e1"; // FEM 39a

export const initiatesOfTheEbonHand: CardDefinition = {
    id: INITIATES_EBON_HAND_ID,
    rarity: "common",
    name: "Initiates of the Ebon Hand",
    oracleText:
        "{1}: Add {B}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
    manaCost: { B: 1 },
    types: ["Creature"],
    subtypes: ["Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "initiates-ebon-hand-mana",
            oracleText:
                "{1}: Add {B}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
            cost: { mana: { X: 1 } },
            useStack: false,
            manaProduced: { B: 1 },
            resolve: (ctx: SpellContext) => {
                ctx.addMana({ B: 1 });
                // CR 602.5 — count includes the current activation (recorded
                // before resolve runs).
                const count = ctx.getActivationCount(
                    "initiates-ebon-hand-mana"
                );
                if (count >= 4) {
                    ctx.scheduleDelayedTrigger(
                        INITIATES_EBON_HAND_ID,
                        "initiates-ebon-hand-sacrifice",
                        "next-end-step",
                        { targetId: ctx.sourceInstanceId }
                    );
                }
            },
        },
    ],
    delayedTriggers: [
        {
            id: "initiates-ebon-hand-sacrifice",
            oracleText:
                "Sacrifice Initiates of the Ebon Hand at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.sacrifice(targetId);
            },
        },
    ],
};

export const initiatesOfTheEbonHandFemB: CardPrint = {
    printId: "03c7dc01-46d0-42be-a1a9-48f69c846d12", // FEM 39b
    definitionId: initiatesOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};

export const initiatesOfTheEbonHandFemC: CardPrint = {
    printId: "62982970-e8b8-4659-bcf0-21aab662d89d", // FEM 39c
    definitionId: initiatesOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};

export const mindstabThrull: CardDefinition = {
    id: "499a791f-ac4f-4a96-b59b-37043686a79a", // FEM 40a (canonical art)
    rarity: "common",
    name: "Mindstab Thrull",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, defending player discards three cards.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "mindstab-thrull-unblocked",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, defending player discards three cards.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKER_UNBLOCKED") return;
                const controllerId = event.attackerControllerId;
                const sac = ctx.requestMayPay({
                    playerId: controllerId,
                    choiceId: `mindstab-thrull-${ctx.sourceInstanceId}`,
                    prompt: "Sacrifice Mindstab Thrull to make the defending player discard three cards?",
                });
                if (sac === undefined) return; // suspended
                if (!sac) return; // declined
                ctx.sacrifice(ctx.sourceInstanceId);
                // CR 506.2 — the defending player is the attacker controller's
                // opponent (2-player / solo).
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== controllerId
                );
                if (!defenderId) return;
                // CR 701.8a — "discards three cards" (the defending player's
                // own choice, clamped to hand size).
                const handSize = ctx.getHandSize(defenderId);
                if (handSize === 0) return;
                const picks = ctx.requestChoice({
                    playerId: defenderId,
                    choiceId: `mindstab-thrull-discard-${ctx.sourceInstanceId}`,
                    kind: "discard-hand",
                    zone: "hand",
                    count: Math.min(3, handSize),
                    prompt: "Discard three cards (Mindstab Thrull).",
                });
                if (picks === undefined) return; // suspended
                for (const id of picks) ctx.discardCard(defenderId, id);
            },
        },
    ],
};

export const mindstabThrullFemB: CardPrint = {
    printId: "781e4b62-3910-4ba1-9e72-e99de8523a94", // FEM 40b
    definitionId: mindstabThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const mindstabThrullFemC: CardPrint = {
    printId: "923189c6-d407-4cc4-a062-2f09a4c7c1e3", // FEM 40c
    definitionId: mindstabThrull.id,
    setCode: "fem",
    rarity: "common",
};

export const necrite: CardDefinition = {
    id: "311d752a-ce8a-44cb-8aeb-1ed66705eb09", // FEM 41a (canonical art)
    rarity: "common",
    name: "Necrite",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, destroy target creature defending player controls. It can't be regenerated.",
    manaCost: { X: 1, B: 2 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "necrite-unblocked",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may sacrifice it. If you do, destroy target creature defending player controls. It can't be regenerated.",
            event: "ATTACKER_UNBLOCKED",
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKER_UNBLOCKED") return;
                const controllerId = event.attackerControllerId;
                // CR 506.2 — defending player = attacker controller's opponent.
                const defenderId = ctx.allPlayerIds.find(
                    (p) => p !== controllerId
                );
                if (!defenderId) return;
                const candidates = ctx.getBattlefieldIds(defenderId, {
                    types: "Creature",
                });
                if (candidates.length === 0) return;
                // CR 603.3d — "you may sacrifice it. If you do, destroy target
                // creature": picking a creature implies the sacrifice; declining
                // (empty pick) leaves the Thrull on the battlefield.
                const picks = ctx.requestChoice({
                    playerId: controllerId,
                    choiceId: `necrite-${ctx.sourceInstanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: defenderId,
                    candidateIds: candidates,
                    count: { min: 0, max: 1 },
                    prompt: "Sacrifice Necrite to destroy a creature the defending player controls? (pick one, or decline)",
                });
                if (picks === undefined) return; // suspended
                const targetId = picks[0];
                if (!targetId) return; // declined
                ctx.sacrifice(ctx.sourceInstanceId);
                ctx.destroy(
                    { type: "permanent", id: targetId },
                    { cantBeRegenerated: true }
                );
            },
        },
    ],
};

export const necriteFemB: CardPrint = {
    printId: "e19a4d41-e7b0-48b3-8e2e-9ac00f119ce2", // FEM 41b
    definitionId: necrite.id,
    setCode: "fem",
    rarity: "common",
};

export const necriteFemC: CardPrint = {
    printId: "660ae99f-4e61-45fd-9436-855a38289c8b", // FEM 41c
    definitionId: necrite.id,
    setCode: "fem",
    rarity: "common",
};

export const orderOfTheEbonHand: CardDefinition = {
    id: "9e51f5d8-a7cc-4720-8af5-e002bcfd78a0", // FEM 42a (canonical art)
    rarity: "common",
    name: "Order of the Ebon Hand",
    oracleText:
        "Protection from white\n{B}: This creature gains first strike until end of turn.\n{B}{B}: This creature gets +1/+0 until end of turn.",
    manaCost: { B: 2 },
    types: ["Creature"],
    subtypes: ["Cleric", "Knight"],
    power: 2,
    toughness: 1,
    staticAbilities: ["protection from white"],
    activatedAbilities: [
        {
            id: "order-ebon-hand-first-strike",
            oracleText:
                "{B}: This creature gains first strike until end of turn.",
            cost: { mana: { B: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant first
            // strike until end of turn (CR 611.1b).
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "order-ebon-hand-pump",
            oracleText: "{B}{B}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { B: 2 } },
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
    ],
};

export const orderOfTheEbonHandFemB: CardPrint = {
    printId: "60ffbb40-13c1-4d01-9421-95b2410d0d3b", // FEM 42b
    definitionId: orderOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};

export const orderOfTheEbonHandFemC: CardPrint = {
    printId: "22c32774-5507-4a60-9ed2-2a570f6ff8e3", // FEM 42c
    definitionId: orderOfTheEbonHand.id,
    setCode: "fem",
    rarity: "common",
};

export const soulExchange: CardDefinition = {
    id: "9f73597d-f453-4d37-b2ef-c54ef683a884", // FEM 43
    rarity: "uncommon",
    name: "Soul Exchange",
    oracleText:
        "As an additional cost to cast this spell, exile a creature you control.\nReturn target creature card from your graveyard to the battlefield. Put a +2/+2 counter on that creature if the exiled creature was a Thrull.",
    manaCost: { B: 2 },
    types: ["Sorcery"],
    additionalCosts: {
        exileFilter: { types: "Creature", controllerRelation: "you" },
    },
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "you",
    },
    // NOT DSL-migratable (ADR 0045): the `+2/+2` counter is gated on whether the
    // exiled additional-cost creature was a Thrull (`getAdditionalCostSubtypes`)
    // — the `if` predicate grammar reads only a bound `$paid` outcome, not a
    // paid-cost object's subtypes; and the reanimated creature is named by the
    // graveyard-card target's post-return instance id, not a covered object
    // selector. Stays resolve().
    resolve: (ctx: SpellContext) => {
        const t = ctx.targets[0];
        if (!t || t.type !== "graveyard-card" || !t.playerId) return;
        const returned = ctx.returnToBattlefield(t.playerId, t.id, "graveyard");
        if (!returned) return;
        // CR 117.9 — the exiled creature's subtypes were snapshotted as the
        // additional cost was paid; a Thrull adds a +2/+2 counter to the
        // reanimated creature.
        const subtypes = ctx.getAdditionalCostSubtypes();
        if (subtypes?.includes("Thrull")) {
            ctx.addCounter({ type: "permanent", id: t.id }, "+2/+2", 1);
        }
    },
};

export const thrullChampion: CardDefinition = {
    id: "4d3cafdd-a03b-4b08-b9c1-c776f8450d3a", // FEM 44
    rarity: "rare",
    name: "Thrull Champion",
    oracleText:
        "Thrull creatures get +1/+1.\n{T}: Gain control of target Thrull for as long as you control this creature.",
    manaCost: { X: 4, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) => ctx.hasSubtype(target, "Thrull"),
            power: 1,
            toughness: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "thrull-champion-steal",
            oracleText:
                "{T}: Gain control of target Thrull for as long as you control this creature.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Thrull",
            },
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                ctx.gainControl(target, ctx.controller, {
                    kind: "controller-controls-source",
                    controllerId: ctx.controller,
                });
            },
        },
    ],
};

export const thrullRetainer: CardDefinition = {
    id: "d800512b-1492-41d2-931d-57c625044454", // FEM 45
    rarity: "uncommon",
    name: "Thrull Retainer",
    oracleText:
        "Enchant creature\nEnchanted creature gets +1/+1.\nSacrifice this Aura: Regenerate enchanted creature.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 1,
            toughness: 1,
        },
    ],
    activatedAbilities: [
        {
            id: "thrull-retainer-regenerate",
            oracleText: "Sacrifice this Aura: Regenerate enchanted creature.",
            cost: { sacrifice: true },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.applyRegenerationShield({ type: "permanent", id: hostId });
            },
        },
    ],
};

export const thrullWizard: CardDefinition = {
    id: "c4e732fb-cbef-4fd8-b704-e4d513a6cf2d", // FEM 46
    rarity: "uncommon",
    name: "Thrull Wizard",
    oracleText:
        "{1}{B}: Counter target black spell unless that spell's controller pays {B} or {3}.",
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Thrull", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "thrull-wizard-counter",
            oracleText:
                "{1}{B}: Counter target black spell unless that spell's controller pays {B} or {3}.",
            cost: { mana: { X: 1, B: 1 } },
            useStack: true,
            targetRequirement: {
                type: "spell",
                count: 1,
                colorFilter: "B",
            },
            // CR 117.3a / 701.5a — "counter unless that spell's controller pays":
            // the spell's controller may pay {B}; if they don't, counter it.
            effects: [
                {
                    op: "mayPay",
                    player: { controllerOf: { target: 0 } },
                    cost: { B: 1 },
                    prompt: "Pay {B} or your spell is countered (Thrull Wizard)?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "counter", target: { target: 0 } }],
                },
            ],
        },
    ],
};

export const tourachsChant: CardDefinition = {
    id: "06883fd2-eccd-47c6-8c34-10d95e923685", // FEM 47
    rarity: "uncommon",
    name: "Tourach's Chant",
    oracleText:
        "At the beginning of your upkeep, sacrifice this enchantment unless you pay {B}.\nWhenever a player puts a Forest onto the battlefield, this enchantment deals 3 damage to that player unless they put a -1/-1 counter on a creature they control.",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    triggeredAbilities: [
        payOrSacrificeUpkeepTrigger({
            id: "tourachs-chant-upkeep",
            cardName: "Tourach's Chant",
            cost: { B: 1 },
            costText: "{B}",
        }),
        enteredTrigger({
            id: "tourachs-chant-forest-punish",
            oracleText:
                "Whenever a player puts a Forest onto the battlefield, this enchantment deals 3 damage to that player unless they put a -1/-1 counter on a creature they control.",
            scope: "any",
            // The PERMANENT_ENTERED payload doesn't carry subtypes, so gate on
            // the entering land's live subtypes read from state (CR 603.4
            // check-time predicate) — mirrors Thelon's Chant.
            condition: (event, _self, state) => {
                if (event.type !== "PERMANENT_ENTERED") return false;
                for (const p of state?.players ?? []) {
                    const perm = p.battlefield.find(
                        (c) => c.id === event.instanceId
                    );
                    if (perm) return perm.subtypes.includes("Forest");
                }
                return false;
            },
            // NOT DSL-migratable (ADR 0045): built via the `enteredTrigger`
            // factory (no `effects[]` site), and the "3 damage unless they put a
            // -1/-1 counter" branch is a punisher choice whose target is the
            // punished player's own creature pick (`requestChoice`) — not a
            // covered object selector. Stays resolve().
            resolve: (ctx, event, entered) => {
                if (event.type !== "PERMANENT_ENTERED") return;
                const player = entered.controllerId;
                const creatures = ctx.getBattlefieldIds(player, {
                    types: "Creature",
                });
                if (creatures.length === 0) {
                    ctx.dealDamage({ type: "player", id: player }, 3);
                    return;
                }
                const picks = ctx.requestChoice({
                    playerId: player,
                    choiceId: `tourachs-chant-counter-${event.instanceId}`,
                    kind: "choose-permanents",
                    zone: "battlefield",
                    zoneOwnerId: player,
                    filter: { types: "Creature" },
                    count: { min: 0, max: 1 },
                    prompt: "Put a -1/-1 counter on a creature you control, or take 3 damage from Tourach's Chant.",
                });
                if (picks === undefined) return; // suspended
                if (picks.length === 0) {
                    ctx.dealDamage({ type: "player", id: player }, 3);
                } else {
                    ctx.addCounter(
                        { type: "permanent", id: picks[0] },
                        "-1/-1",
                        1
                    );
                }
            },
        }),
    ],
};

export const tourachsGate: CardDefinition = {
    id: "d77f6401-a9fb-449c-b511-6fb837055bb4", // FEM 48
    rarity: "rare",
    name: "Tourach's Gate",
    oracleText:
        "Enchant land you control\nSacrifice a Thrull: Put three time counters on this Aura.\nAt the beginning of your upkeep, remove a time counter from this Aura. If there are no time counters on this Aura, sacrifice it.\nTap enchanted land: Attacking creatures you control get +2/-1 until end of turn. Activate only if enchanted land is untapped.",
    manaCost: { X: 1, B: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: {
        type: "Land",
        count: 1,
        controller: "you",
    },
    triggeredAbilities: [
        phaseTrigger({
            id: "tourachs-gate-upkeep",
            phase: "UPKEEP",
            scope: "your",
            oracleText:
                "At the beginning of your upkeep, remove a time counter from this Aura. If there are no time counters on this Aura, sacrifice it.",
            // NOT DSL-migratable (ADR 0045): the `counters` remove is
            // expressible, but "if there are no time counters, sacrifice it" is
            // gated on a counter-COUNT threshold (`getCounterCount` <= 0) — the
            // `if` predicate grammar reads only a bound `$paid` outcome, not a
            // counter tally. Stays resolve() until a counter-count predicate
            // exists.
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.removeCounter(self, "time", 1);
                const remaining = ctx.getCounterCount(self, "time");
                if (remaining <= 0) ctx.sacrifice(ctx.sourceInstanceId);
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "tourachs-gate-add-time",
            oracleText:
                "Sacrifice a Thrull: Put three time counters on this Aura.",
            cost: { sacrificeFilter: { subtypes: ["Thrull"] } },
            useStack: true,
            // CR 122 (issue #841) — put three time counters on the source.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "time",
                    target: { ref: "$source" },
                    count: 3,
                },
            ],
        },
        {
            id: "tourachs-gate-pump",
            oracleText:
                "Tap enchanted land: Attacking creatures you control get +2/-1 until end of turn. Activate only if enchanted land is untapped.",
            // FAITHFUL-TEXT NOTE: the engine has no "tap the enchanted host" as
            // a first-class activation cost. The "tap enchanted land" cost is
            // gated for legality via `canActivate` (host must be untapped) and
            // paid by tapping the host inside resolve (CR 602.1 — functionally
            // equivalent: the host is untapped at activation and tapped as the
            // ability resolves).
            cost: {},
            useStack: true,
            canActivate: (source, state) => {
                const hostId = source.attachedTo;
                if (!hostId) return false;
                for (const p of state.players) {
                    const host = p.battlefield.find((c) => c.id === hostId);
                    if (host) return !host.isTapped;
                }
                return false;
            },
            // NOT DSL-migratable (ADR 0045): taps the ENCHANTED host
            // (`getAttachedToId` — no attached-object selector) and pumps only
            // the controller's ATTACKING creatures (`getIsAttacking` — the
            // forEach `permanents` filter has no attacking/combat predicate).
            // Blocked on: attached-object selector + an attacking-creature filter.
            resolve: (ctx: SpellContext) => {
                // Pay the "tap enchanted land" cost (CR 602.1).
                const hostId = ctx.getAttachedToId();
                if (!hostId) return;
                ctx.tap({ type: "permanent", id: hostId });
                for (const id of ctx.getBattlefieldIds(ctx.controller, {
                    types: "Creature",
                })) {
                    if (ctx.getIsAttacking(id)) {
                        ctx.addTemporaryPTBuff(
                            { type: "permanent", id },
                            2,
                            -1,
                            { phase: "end-of-turn" }
                        );
                    }
                }
            },
        },
    ],
};
