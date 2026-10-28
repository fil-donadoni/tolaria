// C15 — red cards, split by colour per ADR 0043. The registry's
// `import * as c15 from "./sets/c15/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Fiery Confluence — {2}{R}{R} Sorcery. "Choose three. You may choose the
// same mode more than once." A fixed count of three with repeats
// (`modeSelection`, ADR 0094; CR 700.2d): a mode chosen k times is treated as
// k copies in sequence, and the modes resolve in printed order whatever the
// pick order (CR 608.2c, `normalizeChosenModeIds`). Choosing "destroy target
// artifact" twice may name the SAME artifact (CR 700.2d) — the second copy
// then finds it gone and does nothing.
// compiler-gap: "Choose three. You may choose the same mode more than once." (#7224)
export const fieryConfluence = defineCard(() => ({
    id: "7b61c9bc-16e8-417f-99e7-8bd83d4666c5",
    name: "Fiery Confluence",
    rarity: "rare",
    oracleText:
        "Choose three. You may choose the same mode more than once.\n• Fiery Confluence deals 1 damage to each creature.\n• Fiery Confluence deals 2 damage to each opponent.\n• Destroy target artifact.",
    manaCost: { X: 2, R: 2 },
    types: ["Sorcery"],
    modeSelection: { min: 3, max: 3, repeats: true },
    modes: [
        {
            id: "creatures",
            label: "1 damage to each creature",
            oracleText: "Fiery Confluence deals 1 damage to each creature.",
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        { op: "dealDamage", amount: 1, to: { ref: "$each" } },
                    ],
                },
            ],
        },
        {
            id: "opponents",
            label: "2 damage to each opponent",
            oracleText: "Fiery Confluence deals 2 damage to each opponent.",
            effects: [
                { op: "dealDamage", amount: 2, to: { player: "opponent" } },
            ],
        },
        {
            id: "artifact",
            label: "Destroy target artifact",
            oracleText: "Destroy target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
}));
