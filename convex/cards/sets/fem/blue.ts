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
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { stateTrigger } from "../../abilities/triggers/stateTrigger";

export const vodalianSoldiers: CardDefinition = {
    id: "7eb50256-9113-4b03-bcef-9aea24be8493", // FEM 31a (canonical art)
    rarity: "common",
    name: "Vodalian Soldiers",
    oracleText: "",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Soldier"],
    power: 1,
    toughness: 2,
};

export const vodalianSoldiersFemB: CardPrint = {
    printId: "bc85a68c-14d6-4447-a894-0e48d1662bc3", // FEM 31b
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemC: CardPrint = {
    printId: "d8d1ceac-bb75-4c46-9ab4-1ef623ed3027", // FEM 31c
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianSoldiersFemD: CardPrint = {
    printId: "99d22f83-1171-4b5c-8a72-956db26d7c60", // FEM 31d
    definitionId: vodalianSoldiers.id,
    setCode: "fem",
    rarity: "common",
};

// No `imagePrintId` — Scryfall has no printed Camarid token for Homarid
// Spawning Bed (`all_parts` is empty), so this stays a placeholder-rendered
// token by design (issue #941 documented exception).
const CAMARID_TOKEN: TokenSpec = {
    name: "Camarid",
    types: ["Creature"],
    subtypes: ["Camarid"],
    power: 1,
    toughness: 1,
    colors: ["U"],
};

/** CR 121.6 / 614.1c (issue #1693) — the Tide cycle's "this permanent enters
 *  with a tide counter on it" is a REPLACEMENT effect, shared by Homarid and
 *  Tidal Influence. It was previously an `enteredTrigger` carrying a `counters`
 *  Op, which put the placement on the stack: the permanent sat on the
 *  battlefield at ZERO tide counters (so Homarid read as a plain 2/2 instead of
 *  the 1/1 its one-counter `pt-buff` makes it) until the ability resolved, and
 *  the line rendered as a respondable ability. As `entersWith.counters` the
 *  counter is there the first instant the permanent is observable. */
function tideEntersWith(): CardDefinition["entersWith"] {
    return { counters: [{ type: "tide", count: 1 }] };
}

function tideUpkeepTrigger(id: string) {
    return phaseTrigger({
        id,
        oracleText:
            "At the beginning of your upkeep, put a tide counter on this permanent.",
        phase: "UPKEEP",
        scope: "your",
        // CR 122 (issue #841) — put one tide counter on the source.
        effects: [
            {
                op: "counters",
                action: "add",
                counter: "tide",
                target: { ref: "$source" },
                count: 1,
            },
        ],
    });
}

function tideSheddingTrigger(id: string) {
    return stateTrigger({
        id,
        oracleText:
            "Whenever there are four or more tide counters on this permanent, remove all tide counters from it.",
        condition: (self) => (self.counters?.["tide"] ?? 0) >= 4,
        // Migrated resolve()→effects[] (ADR 0045, PRD #795): `stateTrigger`
        // now accepts an `effects[]` site, and the `{ counters: { of, type } }`
        // EffectValue member (a live counter-tally read) lets "remove ALL tide
        // counters" be expressed as "remove a count equal to the current
        // tally" — `removeCounter` clamps to what's present (CR 122.6), so
        // this is exact. Both blockers the old marker cited are stale.
        effects: [
            {
                op: "counters",
                action: "remove",
                counter: "tide",
                target: { ref: "$source" },
                count: { counters: { of: { ref: "$source" }, type: "tide" } },
            },
        ],
    });
}

export const homarid: CardDefinition = {
    id: "d6ffeab4-83b1-4414-ae72-e59a2354ea15", // FEM 19a (canonical art)
    rarity: "common",
    name: "Homarid",
    oracleText:
        "This creature enters with a tide counter on it.\nAt the beginning of your upkeep, put a tide counter on this creature.\nAs long as there is exactly one tide counter on this creature, it gets -1/-1.\nAs long as there are exactly three tide counters on this creature, it gets +1/+1.\nWhenever there are four or more tide counters on this creature, remove all tide counters from it.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Homarid"],
    power: 2,
    toughness: 2,
    entersWith: tideEntersWith(),
    triggeredAbilities: [
        tideUpkeepTrigger("homarid-tide-upkeep"),
        tideSheddingTrigger("homarid-tide-shed"),
    ],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.id,
            condition: (source) => (source.counters?.["tide"] ?? 0) === 1,
            power: -1,
            toughness: -1,
        },
        {
            kind: "pt-buff",
            applies: (target, source) => target.id === source.id,
            condition: (source) => (source.counters?.["tide"] ?? 0) === 3,
            power: 1,
            toughness: 1,
        },
    ],
};

export const homaridFemB: CardPrint = {
    printId: "cbb6c13f-6019-4ad5-9de6-07844c361b41", // FEM 19b
    definitionId: homarid.id,
    setCode: "fem",
    rarity: "common",
};

export const homaridFemC: CardPrint = {
    printId: "33536b0a-1cff-481f-b695-eadaf6897bf0", // FEM 19c
    definitionId: homarid.id,
    setCode: "fem",
    rarity: "common",
};

export const homaridFemD: CardPrint = {
    printId: "18f1cc24-a5fc-43cc-b558-ac7901c48b81", // FEM 19d
    definitionId: homarid.id,
    setCode: "fem",
    rarity: "common",
};

export const tidalInfluence: CardDefinition = {
    id: "b2192c7b-ef6f-4ff6-9017-b1a125340517", // FEM 28
    rarity: "rare",
    name: "Tidal Influence",
    oracleText:
        "Cast this spell only if no permanents named Tidal Influence are on the battlefield.\nThis enchantment enters with a tide counter on it.\nAt the beginning of your upkeep, put a tide counter on this enchantment.\nAs long as there is exactly one tide counter on this enchantment, all blue creatures get -2/-0.\nAs long as there are exactly three tide counters on this enchantment, all blue creatures get +2/+0.\nWhenever there are four or more tide counters on this enchantment, remove all tide counters from it.",
    manaCost: { X: 2, U: 1 },
    types: ["Enchantment"],
    castUniqueByName: true,
    entersWith: tideEntersWith(),
    triggeredAbilities: [
        tideUpkeepTrigger("tidal-influence-tide-upkeep"),
        tideSheddingTrigger("tidal-influence-tide-shed"),
    ],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("U"),
            condition: (source) => (source.counters?.["tide"] ?? 0) === 1,
            power: -2,
            toughness: 0,
        },
        {
            kind: "pt-buff",
            applies: (target, _source, ctx) =>
                ctx.isCreature(target) && ctx.getColors(target).includes("U"),
            condition: (source) => (source.counters?.["tide"] ?? 0) === 3,
            power: 2,
            toughness: 0,
        },
    ],
};

export const homaridWarrior: CardDefinition = {
    id: "627ca588-917f-4768-a69d-3d93c1210390", // FEM 22a (canonical art)
    rarity: "common",
    name: "Homarid Warrior",
    oracleText:
        "{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap it.",
    manaCost: { X: 4, U: 1 },
    types: ["Creature"],
    subtypes: ["Homarid", "Warrior"],
    power: 3,
    toughness: 3,
    activatedAbilities: [
        {
            id: "homarid-warrior-dive",
            oracleText:
                "{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap it.",
            cost: { mana: { U: 1 } },
            useStack: true,
            // DSL-first (ADR 0045): "gains shroud until end of turn" (layer 6
            // grant), "Tap it" (CR 701.26), "doesn't untap during your next
            // untap step" (CR 302.6/502.1) — three $source skins over
            // grantStaticAbility / tap / skipNextUntap, in order.
            effects: [
                {
                    op: "grantAbility",
                    ability: "shroud",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                { op: "tapUntap", action: "tap", target: { ref: "$source" } },
                { op: "skipNextUntap", target: { ref: "$source" } },
            ],
        },
    ],
};

export const homaridWarriorFemB: CardPrint = {
    printId: "c9a9bdcf-543b-4140-b836-9e222a4a9233", // FEM 22b
    definitionId: homaridWarrior.id,
    setCode: "fem",
    rarity: "common",
};

export const homaridWarriorFemC: CardPrint = {
    printId: "fb1cccdc-9c4d-4ef3-807b-278e6fd23230", // FEM 22c
    definitionId: homaridWarrior.id,
    setCode: "fem",
    rarity: "common",
};

export const homaridShaman: CardDefinition = {
    id: "c17c6416-86d6-46ea-aea1-41b98a66b250", // FEM 20
    rarity: "uncommon",
    name: "Homarid Shaman",
    oracleText: "{U}: Tap target green creature.",
    manaCost: { X: 2, U: 2 },
    types: ["Creature"],
    subtypes: ["Homarid", "Shaman"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "homarid-shaman-tap",
            oracleText: "{U}: Tap target green creature.",
            cost: { mana: { U: 1 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1, colorFilter: "G" },
            // Migrated resolve()→effects[] (ADR 0045, #842): tap the announced
            // green-creature target (CR 701.26a).
            effects: [{ op: "tapUntap", action: "tap", target: { target: 0 } }],
        },
    ],
};

export const homaridSpawningBed: CardDefinition = {
    id: "2cbb62fc-3cd9-41a6-804a-4ff9a766897f", // FEM 21
    rarity: "uncommon",
    name: "Homarid Spawning Bed",
    oracleText:
        "{1}{U}{U}, Sacrifice a blue creature: Create X 1/1 blue Camarid creature tokens, where X is the sacrificed creature's mana value.",
    manaCost: { U: 2 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "homarid-spawning-bed-spawn",
            oracleText:
                "{1}{U}{U}, Sacrifice a blue creature: Create X 1/1 blue Camarid creature tokens, where X is the sacrificed creature's mana value.",
            cost: {
                mana: { X: 1, U: 2 },
                sacrificeFilter: { types: "Creature", colors: ["U"] },
            },
            useStack: true,
            // NOT DSL-migratable (ADR 0045): the token COUNT is X = the
            // sacrificed creature's mana value, read at resolve time via
            // `getAdditionalSacrificeMv()`. The `createToken` Op (#847) covers
            // the token creation, but the `EffectValue` grammar
            // (literal | ref | count) has no chosen-cost / paid-cost value
            // member, so "create X tokens where X is the sacrifice's mana value"
            // is not expressible. Planned-migratable once an X value construct
            // exists (PRD #826 Xvalue). Stays resolve().
            resolve: (ctx: SpellContext) => {
                // CR 202.3 — the sacrificed creature's pre-sacrifice mana value
                // was snapshotted onto the stack item when the sacrifice cost
                // was paid; read it here to size the token swarm.
                const mv = ctx.getAdditionalSacrificeMv() ?? 0;
                if (mv > 0) ctx.createToken(CAMARID_TOKEN, ctx.controller, mv);
            },
        },
    ],
};

export const deepSpawn: CardDefinition = {
    id: "69c9e4a5-735f-471c-ab1a-6e6d50ba5724", // FEM 17
    rarity: "rare",
    name: "Deep Spawn",
    oracleText:
        "Trample\nAt the beginning of your upkeep, sacrifice this creature unless you mill two cards.\n{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap this creature.",
    manaCost: { X: 5, U: 3 },
    types: ["Creature"],
    subtypes: ["Homarid"],
    power: 6,
    toughness: 6,
    staticAbilities: ["trample"],
    triggeredAbilities: [
        phaseTrigger({
            id: "deep-spawn-upkeep-mill",
            oracleText:
                "At the beginning of your upkeep, sacrifice this creature unless you mill two cards.",
            phase: "UPKEEP",
            scope: "your",
            // NOT DSL-migratable (ADR 0045): "unless you mill two cards" is an
            // optional-cost decision. `mayPay` is a registered Op, but its
            // `MayPayCost` leg union (mana/life/sacrifice/discard/energy) has
            // no "mill" leg, so the decline branch can't be expressed as a
            // `mayPay` cost — even though the `mill` Op itself (CR 701.17,
            // status implemented) covers the direct-mill primitive on its own.
            // Blocked on: a mill leg for `MayPayCost` (planned-migratable,
            // worth an issue if this shape recurs). Stays resolve().
            resolve: (ctx, _event, scopedPlayerId) => {
                // CR 117.3a — "unless you mill two cards": the upkeep player may
                // mill two (a real cost they choose to pay) to keep Deep Spawn.
                // Declining sacrifices it (CR 701.5a).
                const top = ctx.peekLibraryTop(scopedPlayerId, 2);
                const paid = ctx.requestMayPay({
                    playerId: scopedPlayerId,
                    choiceId: `deep-spawn-mill-${ctx.sourceInstanceId}`,
                    prompt:
                        top.length < 2
                            ? "Mill two cards to keep Deep Spawn? (fewer than two in library)"
                            : "Mill two cards to keep Deep Spawn?",
                });
                if (paid === undefined) return; // suspended
                if (paid) {
                    // CR 701.13a — mill two: move the live top card to the
                    // graveyard twice. Stops naturally once the library empties.
                    for (let i = 0; i < 2; i++) {
                        const t = ctx.peekLibraryTop(scopedPlayerId, 1);
                        if (t.length === 0) break;
                        ctx.moveCardById(
                            scopedPlayerId,
                            t[0],
                            "library",
                            "graveyard"
                        );
                    }
                } else {
                    ctx.sacrifice(ctx.sourceInstanceId);
                }
            },
        }),
    ],
    activatedAbilities: [
        {
            id: "deep-spawn-dive",
            oracleText:
                "{U}: This creature gains shroud until end of turn and doesn't untap during your next untap step. Tap this creature.",
            cost: { mana: { U: 1 } },
            useStack: true,
            // DSL-first (ADR 0045): "gains shroud until end of turn" (layer 6
            // grant), "Tap this creature" (CR 701.26), "doesn't untap during
            // your next untap step" (CR 302.6/502.1) — three $source skins over
            // grantStaticAbility / tap / skipNextUntap, in order.
            effects: [
                {
                    op: "grantAbility",
                    ability: "shroud",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
                { op: "tapUntap", action: "tap", target: { ref: "$source" } },
                { op: "skipNextUntap", target: { ref: "$source" } },
            ],
        },
    ],
};

export const highTide: CardDefinition = {
    id: "4686bbb9-517f-4cce-aa7a-5db41e22c02b", // FEM 18a (canonical art)
    rarity: "common",
    name: "High Tide",
    oracleText:
        "Until end of turn, whenever a player taps an Island for mana, that player adds an additional {U}.",
    manaCost: { U: 1 },
    types: ["Instant"],
    resolve: (ctx: SpellContext) => {
        ctx.addHighTide(ctx.controller);
    },
};

export const highTideFemB: CardPrint = {
    printId: "c2813677-91cc-4c8b-a8ea-403fa776c9f0", // FEM 18b
    definitionId: highTide.id,
    setCode: "fem",
    rarity: "common",
};

export const highTideFemC: CardPrint = {
    printId: "4af611e3-45d6-4aee-bf48-56598b14a242", // FEM 18c
    definitionId: highTide.id,
    setCode: "fem",
    rarity: "common",
};

export const riverMerfolk: CardDefinition = {
    id: "27d7fa54-4b89-4a9a-b088-4b89c525c1ea", // FEM 24
    rarity: "common",
    name: "River Merfolk",
    oracleText: "{U}: This creature gains mountainwalk until end of turn.",
    manaCost: { U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "river-merfolk-mountainwalk",
            oracleText:
                "{U}: This creature gains mountainwalk until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant
            // mountainwalk until end of turn (CR 611.2a).
            effects: [
                {
                    op: "grantAbility",
                    ability: "mountainwalk",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const svyelunitePriest: CardDefinition = {
    id: "316d25ae-7ac6-4f5b-93ab-0e0e28ec104b", // FEM 26
    rarity: "common",
    name: "Svyelunite Priest",
    oracleText:
        "{U}{U}, {T}: Target creature gains shroud until end of turn. Activate only during your upkeep.",
    manaCost: { X: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "svyelunite-priest-shroud",
            oracleText:
                "{U}{U}, {T}: Target creature gains shroud until end of turn. Activate only during your upkeep.",
            cost: { mana: { U: 2 }, tap: true },
            useStack: true,
            // CR 602.5 — "Activate only during your upkeep": the source's
            // controller must be the active player (controllerTurnOnly) and the
            // phase must be UPKEEP (activationPhaseRestriction).
            controllerTurnOnly: true,
            activationPhaseRestriction: ["UPKEEP"],
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #843): grant shroud to the
            // announced target creature until end of turn (CR 611.2a).
            effects: [
                {
                    op: "grantAbility",
                    ability: "shroud",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const vodalianMage: CardDefinition = {
    id: "c107e82b-134a-4f2b-98c2-6537fae6a50d", // FEM 30a (canonical art)
    rarity: "common",
    name: "Vodalian Mage",
    oracleText:
        "{U}, {T}: Counter target spell unless its controller pays {1}.",
    manaCost: { X: 2, U: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Wizard"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "vodalian-mage-counter",
            oracleText:
                "{U}, {T}: Counter target spell unless its controller pays {1}.",
            cost: { mana: { U: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "spell", count: 1 },
            // CR 117.3a / 701.5a — "counter unless its controller pays": the
            // spell's controller may pay {1}; if they don't, counter it.
            effects: [
                {
                    op: "mayPay",
                    player: { controllerOf: { target: 0 } },
                    cost: { X: 1 },
                    prompt: "Pay {1} or your spell is countered (Vodalian Mage)?",
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

export const vodalianMageFemB: CardPrint = {
    printId: "a47beac4-161d-4f8e-9778-78293ff9b383", // FEM 30b
    definitionId: vodalianMage.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianMageFemC: CardPrint = {
    printId: "2b3cc91d-6f87-4f2e-b3c7-8181d19a1f0b", // FEM 30c
    definitionId: vodalianMage.id,
    setCode: "fem",
    rarity: "common",
};

export const vodalianKnights: CardDefinition = {
    id: "68d97e1b-2526-4740-b354-f158734d1f72", // FEM 29
    rarity: "uncommon",
    name: "Vodalian Knights",
    oracleText:
        "First strike\nThis creature can't attack unless defending player controls an Island.\nWhen you control no Islands, sacrifice this creature.\n{U}: This creature gains flying until end of turn.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk", "Knight"],
    power: 2,
    toughness: 2,
    staticAbilities: ["first strike"],
    staticEffects: [
        {
            kind: "attack-restriction",
            id: "vodalian-knights-island-restriction",
            oracleText:
                "This creature can't attack unless defending player controls an Island.",
            predicate: (_self, defenderBattlefield) =>
                defenderBattlefield.some((c) => c.subtypes.includes("Island")),
        },
    ],
    triggeredAbilities: [
        stateTrigger({
            id: "vodalian-knights-no-islands",
            oracleText: "When you control no Islands, sacrifice this creature.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): sacrifice the
            // source (CR 701.16a).
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        }),
    ],
    activatedAbilities: [
        {
            id: "vodalian-knights-fly",
            oracleText: "{U}: This creature gains flying until end of turn.",
            cost: { mana: { U: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant flying
            // until end of turn (CR 611.2a).
            effects: [
                {
                    op: "grantAbility",
                    ability: "flying",
                    target: { ref: "$source" },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const vodalianWarMachine: CardDefinition = {
    id: "cd962ff0-4aa6-453e-931e-bd36fc034273", // FEM 32
    rarity: "rare",
    name: "Vodalian War Machine",
    oracleText:
        "Defender\nTap an untapped Merfolk you control: This creature can attack this turn as though it didn't have defender.\nTap an untapped Merfolk you control: This creature gets +2/+1 until end of turn.\nWhen this creature dies, destroy all Merfolk tapped this turn to pay for its abilities.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Wall"],
    power: 0,
    toughness: 4,
    staticAbilities: ["defender"],
    activatedAbilities: [
        {
            id: "vodalian-war-machine-attack",
            oracleText:
                "Tap an untapped Merfolk you control: This creature can attack this turn as though it didn't have defender.",
            cost: {
                tapOtherFilter: {
                    filter: {
                        types: "Creature",
                        subtypes: "Merfolk",
                        controllerRelation: "you",
                    },
                    count: 1,
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                ctx.allowAttackDespiteDefender({
                    type: "permanent",
                    id: ctx.sourceInstanceId,
                });
            },
        },
        {
            id: "vodalian-war-machine-pump",
            oracleText:
                "Tap an untapped Merfolk you control: This creature gets +2/+1 until end of turn.",
            cost: {
                tapOtherFilter: {
                    filter: {
                        types: "Creature",
                        subtypes: "Merfolk",
                        controllerRelation: "you",
                    },
                    count: 1,
                },
            },
            useStack: true,
            effects: [
                {
                    op: "pump",
                    target: { ref: "$source" },
                    power: 2,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
    // NOTE (faithful-text deferral): the printed death rider — "When this
    // creature dies, destroy all Merfolk tapped this turn to pay for its
    // abilities." — requires per-source bookkeeping of which permanents were
    // tapped to pay THIS card's `tapOtherFilter` costs across the turn, a
    // capability the engine doesn't yet track. The load-bearing mechanic for
    // this slice (the `tapOtherFilter` cost to attack/pump, acceptance
    // criterion) is fully implemented above; the death-destroy rider is
    // deferred and flagged rather than silently dropped (tracked #974; the
    // originally-cited #571 is closed).
};

export const seasinger: CardDefinition = {
    id: "c5266aa1-e2ea-46b9-91ab-b94a7bb7e9f9", // FEM 25
    rarity: "uncommon",
    name: "Seasinger",
    oracleText:
        "When you control no Islands, sacrifice this creature.\nYou may choose not to untap this creature during your untap step.\n{T}: Gain control of target creature whose controller controls an Island for as long as you control this creature and this creature remains tapped.",
    manaCost: { X: 1, U: 2 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 0,
    toughness: 1,
    staticAbilities: ["may-choose-not-to-untap"],
    triggeredAbilities: [
        stateTrigger({
            id: "seasinger-no-islands",
            oracleText: "When you control no Islands, sacrifice this creature.",
            condition: (self, state) => {
                const controller = state.players.find(
                    (p) => p.id === self.controllerId
                );
                return !controller?.battlefield.some((c) =>
                    c.subtypes.includes("Island")
                );
            },
            // Migrated resolve()→effects[] (ADR 0045, PRD #795): sacrifice the
            // source (CR 701.16a).
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        }),
    ],
    activatedAbilities: [
        {
            id: "seasinger-steal",
            oracleText:
                "{T}: Gain control of target creature whose controller controls an Island for as long as you control this creature and this creature remains tapped.",
            cost: { tap: true },
            useStack: true,
            // The engine has no "controller controls subtype X" target filter,
            // so the "whose controller controls an Island" clause (CR 115.4) is
            // enforced at resolution (CR 608.2b — an illegal target makes the
            // ability not resolve) rather than at target enumeration. Targeting
            // is over any creature; the resolve guard fizzles non-Island
            // controllers. (Faithful-text simplification flagged in #571.)
            targetRequirement: { type: "Creature", count: 1 },
            // NOT DSL-migratable (ADR 0045): the ability is guarded by a RUNTIME
            // READ — the target's controller must control an Island (CR 115.4),
            // enforced at resolution because the engine has no "controller
            // controls subtype X" target filter. The gainControl Op (#848) is
            // COVERED, but no `if` predicate can express "the target's
            // controller controls an Island". Blocked on: a controller-controls-
            // subtype predicate — stays resolve().
            resolve: (ctx: SpellContext) => {
                const target = ctx.targets[0];
                if (target?.type !== "permanent") return;
                // CR 115.4 — the target's controller must control an Island.
                const targetController = ctx.getController(target);
                const controlsIsland =
                    ctx.getBattlefieldIds(targetController, {
                        subtypes: "Island",
                    }).length > 0;
                if (!controlsIsland) return;
                // CR 611.2c — control lasts only "for as long as ... this
                // creature remains tapped". The conditional-control SBA reverts
                // it the moment Seasinger untaps or leaves play.
                ctx.gainControl(target, ctx.controller, {
                    kind: "source-tapped",
                });
            },
        },
    ],
};

export const merseine: CardDefinition = {
    id: "b1e96895-ef1d-44fa-b263-bce833fc3109", // FEM 23a (canonical art)
    rarity: "common",
    name: "Merseine",
    oracleText:
        "Enchant creature\nThis Aura enters with three net counters on it.\nEnchanted creature doesn't untap during its controller's untap step if this Aura has a net counter on it.\nPay enchanted creature's mana cost: Remove a net counter from this Aura. Only the controller of the enchanted creature may activate this ability.",
    manaCost: { X: 2, U: 2 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    // CR 121.6 / 614.1c (issue #1693) — "This Aura enters with three net
    // counters on it" is a REPLACEMENT effect, not a triggered ability. As a
    // trigger the Aura attached with ZERO net counters, so its untap lock
    // below (gated on the live net-counter tally) was briefly OFF and the
    // enchanted creature could untap in the window before the ability
    // resolved. `entersWith.counters` puts them on as the Aura enters.
    entersWith: { counters: [{ type: "net", count: 3 }] },
    // CR 502.1 — the enchanted creature doesn't untap while a net counter
    // remains. Expressed as an untap restriction scoped to the Aura's host,
    // gated on the live net-counter count.
    staticEffects: [
        {
            kind: "untap-restriction",
            id: "merseine-untap-lock",
            oracleText:
                "Enchanted creature doesn't untap during its controller's untap step if this Aura has a net counter on it.",
            // Empty filter is ignored when `appliesToHost` is set — the engine
            // synthesizes an instance-id filter for the Aura's host.
            filter: {},
            maxUntap: 0,
            scope: "each-player",
            appliesToHost: true,
            condition: (source) => (source.counters?.["net"] ?? 0) > 0,
        },
    ],
    activatedAbilities: [
        {
            id: "merseine-remove-net",
            oracleText:
                "Pay enchanted creature's mana cost: Remove a net counter from this Aura. Only the controller of the enchanted creature may activate this ability.",
            cost: {
                manaEqualToEnchantedCreatureCost: true,
                removeCounter: { type: "net", count: 1 },
            },
            useStack: true,
            // "Only the controller of the enchanted creature may activate this
            // ability" (CR 602.1). The activating player isn't passed to
            // canActivate, so the engine gates activator identity at the
            // activation entry point; this guard additionally requires the Aura
            // to still be attached (the dynamic cost needs a host).
            canActivate: (source) => source.attachedTo !== undefined,
            activatableByEnchantedController: true,
            // NOT DSL-migratable (ADR 0045): the ability's entire effect is
            // paid as part of the activation COST (the `removeCounter` leg,
            // CR 122.6) — resolution itself does nothing further, but
            // `effects[]` requires a non-empty Op list (`validateEffectScript`
            // rejects `effects: []`), and no no-op Op exists (nor should one
            // be invented for a single card). Stays resolve() as an
            // intentional empty no-op.
            resolve: () => {
                // The net counter was removed as part of the activation cost
                // (CR 122.6); nothing more happens on resolution.
            },
        },
    ],
};

export const merseineFemB: CardPrint = {
    printId: "5c7fb804-65ba-477e-93e8-eea101c1521e", // FEM 23b
    definitionId: merseine.id,
    setCode: "fem",
    rarity: "common",
};

export const merseineFemC: CardPrint = {
    printId: "2dd197f8-ced0-461a-9672-2720a7b70803", // FEM 23c
    definitionId: merseine.id,
    setCode: "fem",
    rarity: "common",
};

export const merseineFemD: CardPrint = {
    printId: "ae7a9e9a-d1f8-44c5-9f79-a1201acfb5fc", // FEM 23d
    definitionId: merseine.id,
    setCode: "fem",
    rarity: "common",
};

export const tidalFlats: CardDefinition = {
    id: "2e820f3f-434e-4d09-91b9-0ebd6966b393", // FEM 27a (canonical art)
    rarity: "common",
    name: "Tidal Flats",
    oracleText:
        "{U}{U}: For each attacking creature without flying, its controller may pay {1}. If that player doesn't, creatures you control blocking that creature gain first strike until end of turn.",
    manaCost: { U: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "tidal-flats-first-strike",
            oracleText:
                "{U}{U}: For each attacking creature without flying, its controller may pay {1}. If that player doesn't, creatures you control blocking that creature gain first strike until end of turn.",
            cost: { mana: { U: 2 } },
            useStack: true,
            // NOT DSL-migratable (ADR 0045): iterates live combat pairings
            // (getBlockersByAttacker) — a per-attacker may-pay whose declined
            // branch grants first strike to a runtime-computed set of blocker
            // ids. forEach selects static zone sets, not combat pairings, and
            // no construct expresses a per-attacker may-pay over computed
            // targets. Blocked on: combat-pairing iteration (planned-
            // migratable); grantStaticAbility itself is covered by
            // grantAbility (#843).
            resolve: (ctx: SpellContext) => {
                // CR 509 / 117.3a — for each non-flying attacker, its controller
                // may pay {1}; if they don't, this Aura's controller's creatures
                // blocking that attacker gain first strike until end of turn.
                // Attacker→blocker pairings are read from the live combat state.
                const blockersByAttacker = ctx.getBlockersByAttacker();
                for (const attackerId of Object.keys(blockersByAttacker)) {
                    const atk = { type: "permanent" as const, id: attackerId };
                    if (ctx.hasStaticAbility(atk, "flying")) continue;
                    const blockers = blockersByAttacker[attackerId].filter(
                        (bId) =>
                            ctx.getController({
                                type: "permanent",
                                id: bId,
                            }) === ctx.controller
                    );
                    // No first-strike payoff possible if this Aura's controller
                    // isn't blocking that attacker — skip the may-pay entirely.
                    if (blockers.length === 0) continue;
                    const atkController = ctx.getController(atk);
                    const paid = ctx.requestMayPay({
                        playerId: atkController,
                        choiceId: `tidal-flats-${ctx.sourceInstanceId}-${attackerId}`,
                        cost: { X: 1 },
                        prompt: "Pay {1} or your attacker's blockers gain first strike (Tidal Flats)?",
                    });
                    if (paid === undefined) return; // suspended
                    if (!paid) {
                        for (const bId of blockers) {
                            ctx.grantStaticAbility(
                                { type: "permanent", id: bId },
                                "first strike",
                                { phase: "end-of-turn" }
                            );
                        }
                    }
                }
            },
        },
    ],
};

export const tidalFlatsFemB: CardPrint = {
    printId: "50e7d376-3e22-44aa-9c96-a3b8eb1568fe", // FEM 27b
    definitionId: tidalFlats.id,
    setCode: "fem",
    rarity: "common",
};

export const tidalFlatsFemC: CardPrint = {
    printId: "445c4767-6261-449c-bb57-713e2a2bb0bf", // FEM 27c
    definitionId: tidalFlats.id,
    setCode: "fem",
    rarity: "common",
};
