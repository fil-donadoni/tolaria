// AVR — black cards, split by colour per ADR 0043. The registry's
// `import * as avr from "./sets/avr"` resolves through avr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Griselbrand — {4}{B}{B}{B}{B} Legendary Creature — Demon 7/7. "Flying,
// lifelink. Pay 7 life: Draw seven cards." (CR 702.9 flying / 702.15 lifelink
// as static keyword strings; CR 119.4 life-payment activation cost, CR 121.1
// draw via the `draw` Op, ADR 0045. Part of the #674 card-draw/card-advantage
// FREE tranche.)
export const griselbrand: CardDefinition = {
    id: "b51666ae-2aef-4cb1-9cd4-44aec81530f8",
    name: "Griselbrand",
    rarity: "mythic",
    oracleText: "Flying, lifelink\nPay 7 life: Draw seven cards.",
    manaCost: { X: 4, B: 4 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Demon"],
    power: 7,
    toughness: 7,
    staticAbilities: ["flying", "lifelink"],
    activatedAbilities: [
        {
            id: "griselbrand-pay-life-draw",
            oracleText: "Pay 7 life: Draw seven cards.",
            cost: { life: 7 },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 7 }],
        },
    ],
};
