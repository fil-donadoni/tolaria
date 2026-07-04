// ROE — red cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Flame Slash — "Flame Slash deals 4 damage to target creature." (CR 120.1
// damage.)
export const flameSlash: CardDefinition = {
    id: "006d2bf1-20f7-4b09-8d98-8233d91682bd",
    rarity: "common",
    name: "Flame Slash",
    oracleText: "Flame Slash deals 4 damage to target creature.",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
};
