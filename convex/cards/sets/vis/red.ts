// VIS — red cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Fireblast — "You may sacrifice two Mountains rather than pay this spell's
// mana cost. Fireblast deals 4 damage to any target." (CR 118.9 alternative
// cost; CR 120.1 damage.) The alternative cost is a censusless rules concept
// (no keyword name); the resolution effect is a single already-censused
// `dealDamage` Op targeting `type: "any"` (CR 115.4 — any target).
export const fireblast: CardDefinition = {
    id: "b1eb5b2c-1f02-48a6-a287-88eb189d6780", // VIS 79
    rarity: "common",
    name: "Fireblast",
    oracleText:
        "You may sacrifice two Mountains rather than pay this spell's mana cost.\nFireblast deals 4 damage to any target.",
    manaCost: { X: 4, R: 2 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    alternativeCosts: [
        {
            id: "sacrifice-two-mountains",
            description: "Sacrifice two Mountains",
            action: "sacrifice",
            count: 2,
            filter: { subtypes: "Mountain" },
        },
    ],
    effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
};
