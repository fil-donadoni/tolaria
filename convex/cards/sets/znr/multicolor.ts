// ZNR — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr"` resolves through znr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Omnath, Locus of Creation — {R}{G}{W}{U} Legendary Creature — Elemental,
// 4/4. "When Omnath, Locus of Creation enters, draw a card. Landfall —
// Whenever a land you control enters, you gain 4 life if this is the first
// time this ability has resolved this turn. If it's the second time, add
// {R}{G}{W}{U}. If it's the third time, Omnath, Locus of Creation deals 4
// damage to each opponent and each planeswalker you don't control." Was a
// tracked stub (#1189) blocked on a per-source per-turn ability-resolution
// counter the engine did not track — SHIPPED as the
// `{ abilityResolutionCount: true }` EffectValue grammar member
// (`GameState.abilityResolutionCounts`, `gre/state.ts`).
//
// The ETB draw is `enteredTrigger` (scope "self"); the Landfall escalation is
// `landfallTrigger` (Landfall CAP, #694) with a THREE-way nested `if` chain on
// `abilityResolutionCount` — no targeting needed ("each opponent" / "each
// planeswalker you don't control" are both untargeted sweeps, CR 102.2
// 2-player-only simplification: "each opponent" is the one other player).
// 4th-or-later landfall this turn falls through every branch as a no-op —
// matches the real card's "choose one that hasn't been chosen this turn" cap
// (only three modes exist, so a fourth trigger has nothing left to choose).
export const omnathLocusOfCreation: CardDefinition = {
    id: "4e4fb50c-a81f-44d3-93c5-fa9a0b37f617",
    name: "Omnath, Locus of Creation",
    rarity: "mythic",
    oracleText:
        "When Omnath, Locus of Creation enters, draw a card.\nLandfall — Whenever a land you control enters, you gain 4 life if this is the first time this ability has resolved this turn. If it's the second time, add {R}{G}{W}{U}. If it's the third time, Omnath, Locus of Creation deals 4 damage to each opponent and each planeswalker you don't control.",
    manaCost: { R: 1, G: 1, W: 1, U: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Elemental"],
    power: 4,
    toughness: 4,
    triggeredAbilities: [
        enteredTrigger({
            id: "omnath-locus-of-creation-etb",
            oracleText: "When Omnath, Locus of Creation enters, draw a card.",
            scope: "self",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
        landfallTrigger({
            id: "omnath-locus-of-creation-landfall",
            oracleText:
                "Landfall — Whenever a land you control enters, you gain 4 life if this is the first time this ability has resolved this turn. If it's the second time, add {R}{G}{W}{U}. If it's the third time, Omnath, Locus of Creation deals 4 damage to each opponent and each planeswalker you don't control.",
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { abilityResolutionCount: true },
                        op: "eq",
                        right: 1,
                    },
                    then: [{ op: "gainLife", player: "controller", amount: 4 }],
                    else: [
                        {
                            op: "if",
                            predicate: {
                                left: { abilityResolutionCount: true },
                                op: "eq",
                                right: 2,
                            },
                            then: [
                                {
                                    op: "addMana",
                                    mana: { R: 1, G: 1, W: 1, U: 1 },
                                },
                            ],
                            else: [
                                {
                                    op: "if",
                                    predicate: {
                                        left: {
                                            abilityResolutionCount: true,
                                        },
                                        op: "eq",
                                        right: 3,
                                    },
                                    then: [
                                        {
                                            op: "dealDamage",
                                            to: { player: "opponent" },
                                            amount: 4,
                                        },
                                        {
                                            op: "forEach",
                                            select: {
                                                set: "permanents",
                                                zone: "battlefield",
                                                controller: "opponent",
                                                filter: {
                                                    type: "Planeswalker",
                                                },
                                            },
                                            effects: [
                                                {
                                                    op: "dealDamage",
                                                    to: { ref: "$each" },
                                                    amount: 4,
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        }),
    ],
};
