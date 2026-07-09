// ONS — red cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons"` resolves through ons/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Lava Dart — {R} Instant. "Lava Dart deals 1 damage to any target.
// Flashback—Sacrifice a Mountain." (CR 702.34, issue #1005, part of the
// Premodern mono-red Burn deck sideboard, PRD #979). The main cast is a plain
// DSL `dealDamage` to the announced "any target" (CR 115.4 — creature /
// planeswalker / battle / player), same shape as Firebolt (ody/red.ts). The
// flashback cast pays NO mana — only the non-mana `FlashbackCost.sacrifice`
// additional cost (CR 702.34a / 118.5): "a Mountain" is a land permanent with
// the Mountain subtype. WHICH Mountain is sacrificed is the caster's explicit
// choice through the unified sacrificeChoice layer (never auto-picked); the
// engine wiring (`convex/gre/flashback.ts` → `getFlashbackAdditionalCost`,
// folded into the cast-time sacrifice selection in `convex/game.ts`
// `buildCastSacrificeSelection`) shipped with #1035/#1037 — this card is its
// first consumer.
export const lavaDart: CardDefinition = {
    id: "865bb1d3-5b7d-40e9-87cc-96be9524a105",
    rarity: "common",
    name: "Lava Dart",
    oracleText:
        "Lava Dart deals 1 damage to any target.\nFlashback—Sacrifice a Mountain. (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
    manaCost: { R: 1 },
    types: ["Instant"],
    // Purely non-mana flashback (no `mana` key) — "Sacrifice a Mountain" only.
    flashback: { sacrifice: { types: "Land", subtypes: "Mountain" } },
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};
