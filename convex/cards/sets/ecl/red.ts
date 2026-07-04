// ECL — red cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Sear — "Sear deals 4 damage to target creature or planeswalker." (CR 120.1
// damage.)
export const sear: CardDefinition = {
    id: "aeb4612c-758b-4492-ba03-eb6741b4176e",
    rarity: "uncommon",
    name: "Sear",
    oracleText: "Sear deals 4 damage to target creature or planeswalker.",
    manaCost: { X: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature", "Planeswalker"], count: 1 },
    effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
};
