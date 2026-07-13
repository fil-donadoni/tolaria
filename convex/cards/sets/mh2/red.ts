// mh2 — red cards (ADR 0043 colour split).
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import type { CardDefinition } from "../../types";

// Mine Collapse — {3}{R} Instant. "If it's your turn, you may sacrifice a
// Mountain rather than pay this spell's mana cost. Mine Collapse deals 5 damage
// to target creature or planeswalker." (CR 118.9 alternative pitch cost —
// sacrifice a Mountain, gated on the your-turn condition; CR 701.16 sacrifice;
// CR 120.1 damage.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// the existing PERMANENT `action: "sacrifice"` leg (Fireblast's shape) narrowed
// to a single Mountain, plus a `condition: your-turn`. The effect is a single
// already-censused `dealDamage` Op to a creature-or-planeswalker target
// (ADR 0045, DSL-first).
export const mineCollapse: CardDefinition = {
    id: "56e2e8b5-660d-4469-a4fe-2367dfadb709", // MH2 135
    rarity: "common",
    name: "Mine Collapse",
    oracleText:
        "If it's your turn, you may sacrifice a Mountain rather than pay this spell's mana cost.\nMine Collapse deals 5 damage to target creature or planeswalker.",
    manaCost: { X: 3, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature", "Planeswalker"], count: 1 },
    alternativeCosts: [
        {
            id: "pitch-sacrifice-mountain",
            description: "Sacrifice a Mountain",
            action: "sacrifice",
            count: 1,
            filter: { subtypes: "Mountain" },
            condition: { kind: "your-turn" },
        },
    ],
    effects: [{ op: "dealDamage", amount: 5, to: { target: 0 } }],
};

export const fury: CardDefinition = {
    id: "bd281158-8180-40b9-a5b7-03cfc712d81a",
    name: "Fury",
    rarity: "mythic",
    manaCost: { X: 3, R: 2 },
    types: ["Creature"],
    subtypes: ["Elemental", "Incarnation"],
    power: 3,
    toughness: 3,
    alternativeCosts: [
        {
            id: "pitch-exile-red",
            description: "Exile a red card from your hand",
            handCost: {
                action: "exile",
                requirements: [{ filter: { color: "R" }, count: 1 }],
            },
        },
    ],
    triggeredAbilities: [
        enteredTrigger({
            id: "fury-etb",
            oracleText:
                "When this creature enters, it deals 4 damage divided as you choose among any number of target creatures and/or planeswalkers.",
            scope: "any",
            targetRequirement: {
                type: "Creature",
                count: { min: 1 },
                divideAsChosen: { total: 4 },
            },
            resolve: (ctx) => {
                ctx.dealDamageDividedAsChosen(ctx.targets, 4);
            },
        }),
    ],
};

// Unholy Heat — {R} Instant. "Unholy Heat deals 2 damage to target creature or
// planeswalker. Delirium — Unholy Heat deals 6 damage instead if there are four
// or more card types among cards in your graveyard." (Delirium ability word —
// engine infra, no registry row.)
export const unholyHeat: CardDefinition = {
    id: "4e879386-b1f8-4f2a-9820-6e1291746f88",
    rarity: "common",
    name: "Unholy Heat",
    oracleText:
        "Unholy Heat deals 2 damage to target creature or planeswalker.\nDelirium — Unholy Heat deals 6 damage instead if there are four or more card types among cards in your graveyard.",
    manaCost: { R: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: 1,
    },
    effects: [
        {
            op: "if",
            predicate: {
                left: {
                    count: {
                        zone: "graveyard",
                        controller: "controller",
                        countTypes: true,
                    },
                },
                op: "ge",
                right: 4,
            },
            then: [{ op: "dealDamage", amount: 6, to: { target: 0 } }],
            else: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

export {};
