// C15 — blue cards, split by colour per ADR 0043. The registry's
// `import * as c15 from "./sets/c15/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Mystic Confluence — {3}{U}{U} Instant. "Choose three. You may choose the
// same mode more than once." Same cardinality shape as Fiery Confluence
// (`c15/red.cards.ts`): three picks with repeats (`modeSelection`, ADR 0094;
// CR 700.2d), resolved in printed order (CR 608.2c). The counter mode is the
// Mana Leak shape (`sth/blue.cards.ts`); chosen twice on one spell, its
// controller is asked to pay {3} once per copy.
// compiler-gap: "Choose three. You may choose the same mode more than once." (#7224)
export const mysticConfluence = defineCard(() => ({
    id: "81bbffc2-6f58-4baa-8f95-168eab106b15",
    name: "Mystic Confluence",
    rarity: "rare",
    oracleText:
        "Choose three. You may choose the same mode more than once.\n• Counter target spell unless its controller pays {3}.\n• Return target creature to its owner's hand.\n• Draw a card.",
    manaCost: { X: 3, U: 2 },
    types: ["Instant"],
    modeSelection: { min: 3, max: 3, repeats: true },
    modes: [
        {
            id: "counter",
            label: "Counter target spell unless its controller pays {3}",
            oracleText: "Counter target spell unless its controller pays {3}.",
            targetRequirement: { type: "spell", count: 1 },
            effects: [
                {
                    op: "mayPay",
                    player: { controllerOf: { target: 0 } },
                    cost: { X: 3 },
                    prompt: "Pay {3} to prevent your spell from being countered?",
                    bind: "$paid",
                },
                {
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "counter", target: { target: 0 } }],
                },
            ],
        },
        {
            id: "bounce",
            label: "Return target creature to its owner's hand",
            oracleText: "Return target creature to its owner's hand.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "draw",
            label: "Draw a card",
            oracleText: "Draw a card.",
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
}));
