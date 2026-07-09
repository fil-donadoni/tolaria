// ZEN — red cards, split by colour per ADR 0043. The registry's
// `import * as zen from "./sets/zen"` resolves through zen/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Burst Lightning — "Kicker {4}. Burst Lightning deals 2 damage to any target.
// If this spell was kicked, it deals 4 damage instead." (CR 702.33 Kicker,
// CR 120.) The target set is unchanged by the kick; only the amount differs, so
// the effect branches on `{ kickerCount: true } >= 1`. Vintage Cube Kicker
// cluster (issue #692, ADR 0041).
export const burstLightning: CardDefinition = {
    id: "2dc16614-5cf8-444d-a5ae-cac25018af68",
    rarity: "common",
    name: "Burst Lightning",
    oracleText:
        "Kicker {4} (You may pay an additional {4} as you cast this spell.)\nBurst Lightning deals 2 damage to any target. If this spell was kicked, it deals 4 damage instead.",
    manaCost: { R: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 4 } },
    targetRequirement: { type: "any", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
            else: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};
