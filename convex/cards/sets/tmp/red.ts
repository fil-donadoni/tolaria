// TMP — red cards, split by colour per ADR 0043. The registry's
// `import * as tmp from "./sets/tmp"` resolves through tmp/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Goblin Bombardment — "Sacrifice a creature: This enchantment deals 1
// damage to any target." (CR 701.16 sacrifice cost, CR 120.1 damage.) The
// sacrificed creature is any creature the activating player controls (not
// necessarily this permanent, since Goblin Bombardment is an Enchantment,
// not a creature) — `cost.sacrificeFilter` needs no `excludeInstanceIds`
// (this permanent isn't itself a creature, so it can never satisfy its own
// filter).
export const goblinBombardment: CardDefinition = {
    id: "179e954f-1d90-4ef4-b800-25845cc338e2",
    rarity: "uncommon",
    name: "Goblin Bombardment",
    oracleText:
        "Sacrifice a creature: This enchantment deals 1 damage to any target.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "goblin-bombardment-sac",
            oracleText:
                "Sacrifice a creature: This enchantment deals 1 damage to any target.",
            cost: { sacrificeFilter: { types: "Creature" } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
};
