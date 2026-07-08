// NEM — red cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Seal of Fire — "Sacrifice this enchantment: It deals 2 damage to any
// target." A "Seal" permanent: it enters as an Enchantment and stores a
// one-shot removal spell, cashed in by sacrificing itself as an activation
// cost (CR 602.1 / 701.21 sacrifice) with no mana and no tap — activatable
// any time you have priority. The sacrifice of THIS source is `cost.sacrifice`
// (distinct from `sacrificeFilter`, which sacrifices a chosen matching
// permanent — Goblin Bombardment). DSL-first: the effect is a single
// `dealDamage` Op to the announced any-target (CR 120.1). The source is
// removed to the graveyard at cost payment, before the ability resolves off
// its stack-item clone.
export const sealOfFire: CardDefinition = {
    id: "37eaf1f6-4bdc-4669-9a15-50b65e016ccf",
    rarity: "common",
    name: "Seal of Fire",
    oracleText: "Sacrifice this enchantment: It deals 2 damage to any target.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "seal-of-fire-sac",
            oracleText:
                "Sacrifice this enchantment: It deals 2 damage to any target.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};
