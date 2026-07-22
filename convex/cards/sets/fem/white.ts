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

import type { CardDefinition, CardPrint, SpellContext } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { tokenPrintIdFor } from "../../tokenPrintLookup";

export const combatMedic: CardDefinition = {
    id: "9cfd96cb-03d6-4845-8595-50bf17b35726", // FEM 1a
    rarity: "common",
    name: "Combat Medic",
    oracleText:
        "{1}{W}: Prevent the next 1 damage that would be dealt to any target this turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Soldier"],
    power: 0,
    toughness: 2,
    activatedAbilities: [
        {
            id: "combat-medic-prevent",
            oracleText:
                "{1}{W}: Prevent the next 1 damage that would be dealt to any target this turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #845): a prevent-the-next-1
            // shield on the announced "any" target (CR 615.1).
            effects: [
                {
                    op: "preventDamage",
                    mode: "next-n",
                    to: { target: 0 },
                    amount: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const combatMedicFemB: CardPrint = {
    printId: "2a324a98-31c2-470a-b792-96b6b098a58c", // FEM 1b
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};

export const combatMedicFemC: CardPrint = {
    printId: "ee9d1eac-3ac2-4881-a984-e40d87f60784", // FEM 1c
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};

export const combatMedicFemD: CardPrint = {
    printId: "8f26c079-61ea-436d-89ae-2f1c6f863e91", // FEM 1d
    definitionId: combatMedic.id,
    setCode: "fem",
    rarity: "common",
};

const FARRELS_MANTLE_ID = "af092da3-8713-4a59-86d3-827b942d6456"; // FEM 2

export const farrelsMantle: CardDefinition = {
    id: FARRELS_MANTLE_ID,
    rarity: "common",
    name: "Farrel's Mantle",
    oracleText:
        "Enchant creature\nWhenever enchanted creature attacks and isn't blocked, its controller may have it deal damage equal to its power plus 2 to another target creature. If that player does, the attacking creature assigns no combat damage this turn.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    triggeredAbilities: [
        {
            id: "farrels-mantle-unblocked",
            oracleText:
                "Whenever enchanted creature attacks and isn't blocked, its controller may have it deal damage equal to its power plus 2 to another target creature. If that player does, the attacking creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            // CR 603.3d — "another target creature" is a REAL target chosen when
            // the trigger is put on the stack (via `raiseTriggerTargetSelection`,
            // issue #1193), NOT a resolution-time `requestChoice`. This makes it
            // subject to hexproof / protection / ward and fires "becomes the
            // target of an ability" triggers, which the old choice-as-target
            // workaround silently skipped.
            //
            // DIVERGENCE (tracked-by: #1193): the Oracle "ANOTHER target
            // creature" must exclude the ENCHANTED (attacking) creature — but
            // the source of this trigger is the AURA permanent, not the
            // enchanted creature. `targetRequirement.excludeSource` only
            // excludes the trigger's own source (`triggerSourceId` = the Aura,
            // which isn't a creature and is already outside the "Creature"
            // candidate set), so it cannot express "other than the enchanted
            // creature". The enchanted creature therefore remains a legal
            // target here; a dedicated exclude-attacker facet is out of scope
            // for the #1193 tracer and needs a follow-up capability.
            targetRequirement: { type: "Creature", count: 1 },
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                self.attachedTo !== undefined &&
                event.attackerId === self.attachedTo,
            resolve: (ctx, event) => {
                if (event.type !== "ATTACKER_UNBLOCKED") return;
                // Target chosen at stack placement (CR 603.3d) — read the
                // locked target, don't request a resolution-time choice.
                const target = ctx.targets[0];
                if (!target) return; // no legal target locked (CR 608.2b)
                const attacker = {
                    type: "permanent" as const,
                    id: event.attackerId,
                };
                const power = ctx.getPower(attacker) ?? 0;
                ctx.dealDamage({ type: "permanent", id: target.id }, power + 2);
                // CR 510.1c — "the attacking creature assigns no combat damage
                // this turn."
                ctx.markAssignsNoCombatDamage(attacker);
            },
        },
    ],
};

export const farrelsZealot: CardDefinition = {
    id: "0401bd23-9f81-40b7-a6c2-e3f9847d175c", // FEM 3a
    rarity: "common",
    name: "Farrel's Zealot",
    oracleText:
        "Whenever this creature attacks and isn't blocked, you may have it deal 3 damage to target creature. If you do, this creature assigns no combat damage this turn.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        {
            id: "farrels-zealot-unblocked",
            oracleText:
                "Whenever this creature attacks and isn't blocked, you may have it deal 3 damage to target creature. If you do, this creature assigns no combat damage this turn.",
            event: "ATTACKER_UNBLOCKED",
            // CR 603.3d — "target creature" is a REAL target chosen when the
            // trigger is put on the stack (via `raiseTriggerTargetSelection`,
            // issue #1193), NOT a resolution-time `requestChoice`. This makes it
            // subject to hexproof / protection / ward and fires "becomes the
            // target of an ability" triggers. No `excludeSource`: the Oracle
            // says plain "target creature" (no "another"), so Farrel's Zealot
            // is itself a legal target.
            targetRequirement: { type: "Creature", count: 1 },
            matches: (event, self) =>
                event.type === "ATTACKER_UNBLOCKED" &&
                event.attackerId === self.id,
            resolve: (ctx) => {
                const self = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                // Target chosen at stack placement (CR 603.3d) — read the
                // locked target, don't request a resolution-time choice.
                const target = ctx.targets[0];
                if (!target) return; // no legal target locked (CR 608.2b)
                ctx.dealDamage({ type: "permanent", id: target.id }, 3);
                ctx.markAssignsNoCombatDamage(self);
            },
        },
    ],
};

export const farrelsZealotFemB: CardPrint = {
    printId: "9e3aeee7-975c-419a-bfb3-45bb48ba6918", // FEM 3b
    definitionId: farrelsZealot.id,
    setCode: "fem",
    rarity: "common",
};

export const farrelsZealotFemC: CardPrint = {
    printId: "54252fd2-21a6-40d1-8515-697f18c78a06", // FEM 3c
    definitionId: farrelsZealot.id,
    setCode: "fem",
    rarity: "common",
};

const FARRELITE_PRIEST_ID = "e11bf79b-a951-4d0c-acdf-d8ba5290a648"; // FEM 4

export const farrelitePriest: CardDefinition = {
    id: FARRELITE_PRIEST_ID,
    rarity: "common",
    name: "Farrelite Priest",
    oracleText:
        "{1}: Add {W}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
    manaCost: { X: 1, W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 3,
    activatedAbilities: [
        {
            id: "farrelite-priest-mana",
            oracleText:
                "{1}: Add {W}. If this ability has been activated four or more times this turn, sacrifice this creature at the beginning of the next end step.",
            cost: { mana: { X: 1 } },
            // CR 605.1a — this adds mana and isn't a tap ability: it's a mana
            // ability (does NOT use the stack) but is repeatable (no {T}).
            useStack: false,
            manaProduced: { W: 1 },
            // NOT DSL-migratable (ADR 0045): the `addMana {W}` half is trivial,
            // but the conditional "if activated four or more times this turn,
            // schedule a sacrifice" gates on a per-turn ACTIVATION COUNT
            // (getActivationCount) — a runtime read the `if` predicate's
            // comparison operands (literal / ref / count) cannot express (count
            // is a battlefield/graveyard cardinality, not an activation tally).
            // Planned-migratable. Blocked on: an activation-count predicate
            // operand.
            resolve: (ctx: SpellContext) => {
                ctx.addMana({ W: 1 });
                // CR 602.5 — count includes the current activation (recorded
                // before resolve runs).
                const count = ctx.getActivationCount("farrelite-priest-mana");
                if (count >= 4) {
                    ctx.scheduleDelayedTrigger(
                        FARRELITE_PRIEST_ID,
                        "farrelite-priest-sacrifice",
                        "next-end-step",
                        { targetId: ctx.sourceInstanceId }
                    );
                }
            },
        },
    ],
    delayedTriggers: [
        {
            id: "farrelite-priest-sacrifice",
            oracleText:
                "Sacrifice Farrelite Priest at the beginning of the next end step.",
            timing: "next-end-step",
            resolve: (ctx, payload) => {
                const targetId = payload.targetId;
                if (!targetId) return;
                ctx.sacrifice(targetId);
            },
        },
    ],
};

export const handOfJustice: CardDefinition = {
    id: "7a899b2d-825c-4929-a769-f4df70bf6a17", // FEM 5
    rarity: "rare",
    name: "Hand of Justice",
    oracleText:
        "{T}, Tap three untapped white creatures you control: Destroy target creature.",
    manaCost: { X: 5, W: 1 },
    types: ["Creature"],
    subtypes: ["Avatar"],
    power: 2,
    toughness: 6,
    activatedAbilities: [
        {
            id: "hand-of-justice-destroy",
            oracleText:
                "{T}, Tap three untapped white creatures you control: Destroy target creature.",
            cost: {
                tap: true,
                tapOtherFilter: {
                    filter: {
                        types: "Creature",
                        colors: "W",
                        controllerRelation: "you",
                    },
                    count: 3,
                },
            },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};

export const heroism: CardDefinition = {
    id: "08ee87a0-a7eb-4472-9045-85d11e8a1501", // FEM 6
    rarity: "common",
    name: "Heroism",
    oracleText:
        "Sacrifice a white creature: For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "heroism-prevent",
            oracleText:
                "Sacrifice a white creature: For each attacking red creature, prevent all combat damage that would be dealt by that creature this turn unless its controller pays {2}{R}.",
            cost: {
                // A sacrifice cost is always paid from the activating player's
                // own battlefield, so no `controllerRelation` is needed (nor
                // supported — the cost-validation call sites pass no
                // `selfControllerId`; a `controllerRelation` here never matches).
                sacrificeFilter: {
                    types: "Creature",
                    colors: "W",
                },
            },
            useStack: true,
            resolve: (ctx: SpellContext) => {
                // CR 615 — for each attacking red creature, its controller may
                // pay {2}{R} to avoid the prevention; otherwise it assigns no
                // combat damage this turn.
                const attackers = ctx.allPlayerIds.flatMap((p) =>
                    ctx
                        .getBattlefieldIds(p, {
                            types: "Creature",
                            colors: "R",
                            isAttacking: true,
                        })
                        .map((id) => ({ id, owner: p }))
                );
                for (const { id, owner } of attackers) {
                    const paid = ctx.requestMayPay({
                        playerId: owner,
                        choiceId: `heroism-${ctx.sourceInstanceId}-${id}`,
                        cost: { X: 2, R: 1 },
                        prompt: "Heroism: pay {2}{R} or this attacking red creature assigns no combat damage this turn.",
                    });
                    if (paid === undefined) return; // suspended
                    if (!paid) {
                        ctx.markAssignsNoCombatDamage({
                            type: "permanent",
                            id,
                        });
                    }
                }
            },
        },
    ],
};

export const icatianInfantry: CardDefinition = {
    id: "f95d42d8-ba75-43bf-81b8-b02374f03e83", // FEM 7a
    rarity: "common",
    name: "Icatian Infantry",
    oracleText:
        "{1}: This creature gains first strike until end of turn.\n{1}: This creature gains banding until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-infantry-first-strike",
            oracleText:
                "{1}: This creature gains first strike until end of turn.",
            cost: { mana: { X: 1 } },
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
            id: "icatian-infantry-banding",
            oracleText: "{1}: This creature gains banding until end of turn.",
            cost: { mana: { X: 1 } },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, #843): self-grant banding
            // until end of turn (CR 611.1b).
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

export const icatianInfantryFemB: CardPrint = {
    printId: "e0e4a9d2-ea43-46ac-8b8b-00496a478103", // FEM 7b
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianInfantryFemC: CardPrint = {
    printId: "efac583d-a492-45ee-8c52-60a6422b2168", // FEM 7c
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianInfantryFemD: CardPrint = {
    printId: "96b2a8d4-7c06-454c-9923-553294aada4f", // FEM 7d
    definitionId: icatianInfantry.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianJavelineers: CardDefinition = {
    id: "f04b8356-2384-4743-80dd-f15ca7ec65f7", // FEM 8a
    rarity: "common",
    name: "Icatian Javelineers",
    oracleText:
        "This creature enters with a javelin counter on it.\n{T}, Remove a javelin counter from this creature: It deals 1 damage to any target.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    entersWith: { counters: [{ type: "javelin", count: 1 }] },
    activatedAbilities: [
        {
            id: "icatian-javelineers-throw",
            oracleText:
                "{T}, Remove a javelin counter from this creature: It deals 1 damage to any target.",
            cost: {
                tap: true,
                removeCounter: { type: "javelin", count: 1 },
            },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};

export const icatianJavelineersFemB: CardPrint = {
    printId: "c70f8f50-866a-4889-b986-48636225638a", // FEM 8b
    definitionId: icatianJavelineers.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianJavelineersFemC: CardPrint = {
    printId: "2be5ab7a-e7db-4c09-8df2-6fe55fa4a116", // FEM 8c
    definitionId: icatianJavelineers.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianLieutenant: CardDefinition = {
    id: "39fec59a-4ade-4c6f-ae7d-911fbe6da26d", // FEM 9
    rarity: "uncommon",
    name: "Icatian Lieutenant",
    oracleText: "{1}{W}: Target Soldier creature gets +1/+0 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 2,
    activatedAbilities: [
        {
            id: "icatian-lieutenant-pump",
            oracleText:
                "{1}{W}: Target Soldier creature gets +1/+0 until end of turn.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                subtypeFilter: "Soldier",
            },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const icatianMoneychanger: CardDefinition = {
    id: "b3d502d4-4a96-47b3-ae26-8b2c9f36623d", // FEM 10a
    rarity: "common",
    name: "Icatian Moneychanger",
    oracleText:
        "This creature enters with three credit counters on it.\nWhen this creature enters, it deals 3 damage to you.\nAt the beginning of your upkeep, put a credit counter on this creature.\nSacrifice this creature: You gain 1 life for each credit counter on this creature. Activate only during your upkeep.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human"],
    power: 0,
    toughness: 2,
    entersWith: { counters: [{ type: "credit", count: 3 }] },
    triggeredAbilities: [
        enteredTrigger({
            id: "icatian-moneychanger-etb-damage",
            oracleText: "When this creature enters, it deals 3 damage to you.",
            scope: "self",
            // Migrated resolve()→effects[] (ADR 0045, #795): 3 damage to the
            // source's controller (CR 120.1). enteredTrigger binds
            // ctx.controller to the source's controller for every scope.
            effects: [
                { op: "dealDamage", amount: 3, to: { player: "controller" } },
            ],
        }),
        phaseTrigger({
            id: "icatian-moneychanger-upkeep-counter",
            oracleText:
                "At the beginning of your upkeep, put a credit counter on this creature.",
            phase: "UPKEEP",
            scope: "your",
            // CR 122 (issue #841) — put one credit counter on the source.
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "credit",
                    target: { ref: "$source" },
                    count: 1,
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "icatian-moneychanger-cash-out",
            oracleText:
                "Sacrifice this creature: You gain 1 life for each credit counter on this creature. Activate only during your upkeep.",
            cost: { sacrifice: true },
            useStack: true,
            controllerTurnOnly: true,
            activationPhaseRestriction: ["UPKEEP"],
            // Migrated resolve()→effects[] (ADR 0045, #795): gain life equal
            // to the credit-counter count on the (already-sacrificed) source.
            // `$source` after a sacrifice-as-cost activation is a named CR
            // 608.2g last-known-information case the `counters` EffectValue's
            // reader handles directly (interpreter.ts, comment cites Icatian
            // Moneychanger by name) — no `if (count > 0)` guard needed, the
            // `gainLife` Op already no-ops for amount <= 0.
            effects: [
                {
                    op: "gainLife",
                    player: "controller",
                    amount: {
                        counters: { of: { ref: "$source" }, type: "credit" },
                    },
                },
            ],
        },
    ],
};

export const icatianMoneychangerFemB: CardPrint = {
    printId: "cbf9194c-8e50-4f50-9a87-3b339a5bc279", // FEM 10b
    definitionId: icatianMoneychanger.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianMoneychangerFemC: CardPrint = {
    printId: "cf9521ae-6fac-4d86-9c60-adecaae5687d", // FEM 10c
    definitionId: icatianMoneychanger.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianPhalanx: CardDefinition = {
    id: "7bc02d30-3eef-4a48-8b11-b4f37219ab3a", // FEM 11
    rarity: "uncommon",
    name: "Icatian Phalanx",
    oracleText:
        "Banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)",
    manaCost: { X: 4, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 2,
    toughness: 4,
    staticAbilities: ["banding"],
};

export const icatianPriest: CardDefinition = {
    id: "d7690cdd-6610-4310-9e93-60dc4db2ae8d", // FEM 12
    rarity: "uncommon",
    name: "Icatian Priest",
    oracleText: "{1}{W}{W}: Target creature gets +1/+1 until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-priest-pump",
            oracleText:
                "{1}{W}{W}: Target creature gets +1/+1 until end of turn.",
            cost: { mana: { X: 1, W: 2 } },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 1,
                    toughness: 1,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const icatianScout: CardDefinition = {
    id: "86bf4aaa-a9b1-4798-a96b-c3e35afb77f7", // FEM 13a
    rarity: "common",
    name: "Icatian Scout",
    oracleText:
        "{1}, {T}: Target creature gains first strike until end of turn.",
    manaCost: { W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier", "Scout"],
    power: 1,
    toughness: 1,
    activatedAbilities: [
        {
            id: "icatian-scout-first-strike",
            oracleText:
                "{1}, {T}: Target creature gains first strike until end of turn.",
            cost: { mana: { X: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            // Migrated resolve()→effects[] (ADR 0045, #843): grant first strike
            // to the announced target creature until end of turn (CR 611.1b).
            effects: [
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

export const icatianScoutFemB: CardPrint = {
    printId: "e9db3442-01cb-4db2-ac33-8eca6880c315", // FEM 13b
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianScoutFemC: CardPrint = {
    printId: "6c461655-a05d-4eed-85b2-04d554f5ec50", // FEM 13c
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};

export const icatianScoutFemD: CardPrint = {
    printId: "db63ad7f-6dc4-4249-b360-46ec5569a5a9", // FEM 13d
    definitionId: icatianScout.id,
    setCode: "fem",
    rarity: "common",
};

// DIVERGENCE (tracked #974): the "Whenever this creature attacks, all creatures
// banded with it gain first strike until end of turn" trigger is NOT modelled.
// It requires enumerating the attacking band's members at trigger time (CR
// 702.22 banding), a capability the engine doesn't yet expose to a trigger. The
// printed first strike + banding keywords ship; the band-wide first-strike grant
// is deferred rather than silently dropped.
export const icatianSkirmishers: CardDefinition = {
    id: "15f6d115-c02d-45a3-aa6d-402964df47dd", // FEM 14
    rarity: "uncommon",
    name: "Icatian Skirmishers",
    oracleText:
        "First strike; banding (Any creatures with banding, and up to one without, can attack in a band. Bands are blocked as a group. If any creatures with banding you control are blocking or being blocked by a creature, you divide that creature's combat damage, not its controller, among any of the creatures it's being blocked by or is blocking.)\nWhenever this creature attacks, all creatures banded with it gain first strike until end of turn.",
    manaCost: { X: 3, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 1,
    toughness: 1,
    staticAbilities: ["first strike", "banding"],
};

const ICATIAN_TOWN_ID = "cbb7c28d-0366-4d01-84a2-f1bc9f38aa4a"; // FEM 15

export const icatianTown: CardDefinition = {
    id: ICATIAN_TOWN_ID,
    rarity: "uncommon",
    name: "Icatian Town",
    oracleText: "Create four 1/1 white Citizen creature tokens.",
    manaCost: { X: 5, W: 1 },
    types: ["Sorcery"],
    // Migrated resolve()→effects[] (ADR 0045, #847): create four 1/1 white
    // Citizen tokens on the controller's battlefield (CR 111 / 707.1).
    effects: [
        {
            op: "createToken",
            token: {
                name: "Citizen",
                types: ["Creature"],
                subtypes: ["Citizen"],
                power: 1,
                toughness: 1,
                colors: ["W"],
                imagePrintId: tokenPrintIdFor(ICATIAN_TOWN_ID, "Citizen"),
            },
            controller: "controller",
            count: 4,
        },
    ],
};

export const orderOfLeitbur: CardDefinition = {
    id: "ebd6e51e-f042-4673-a898-291607105829", // FEM 16a
    rarity: "uncommon",
    name: "Order of Leitbur",
    oracleText:
        "Protection from black\n{W}: This creature gains first strike until end of turn.\n{W}{W}: This creature gets +1/+0 until end of turn.",
    manaCost: { W: 2 },
    types: ["Creature"],
    subtypes: ["Human", "Cleric", "Knight"],
    power: 2,
    toughness: 1,
    staticAbilities: ["protection from black"],
    activatedAbilities: [
        {
            id: "order-of-leitbur-first-strike",
            oracleText:
                "{W}: This creature gains first strike until end of turn.",
            cost: { mana: { W: 1 } },
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
            id: "order-of-leitbur-pump",
            oracleText: "{W}{W}: This creature gets +1/+0 until end of turn.",
            cost: { mana: { W: 2 } },
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

export const orderOfLeitburFemB: CardPrint = {
    printId: "fb537b5a-d725-420d-bc15-0d54ba23331c", // FEM 16b
    definitionId: orderOfLeitbur.id,
    setCode: "fem",
    rarity: "uncommon",
};

export const orderOfLeitburFemC: CardPrint = {
    printId: "1373dea4-3565-4612-8505-ab8fba3ddb67", // FEM 16c
    definitionId: orderOfLeitbur.id,
    setCode: "fem",
    rarity: "uncommon",
};
