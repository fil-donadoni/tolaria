// VIS — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Simoon — {R}{G} Instant. "Simoon deals 1 damage to each creature target
// opponent controls." (CR 115 `controller: "opponent"` player target, CR
// 120.1 damage — a `forEach` battlefield sweep scoped to the TARGETED
// player via the `{ target: 0 }` `EffectPlayerRef` shape, the Do or Die
// `controller: { target: 0 }` `divideIntoPiles.objects` precedent
// generalized to a plain `forEach` selector, `inv/black.ts`.)
//
// Home set = earliest paper printing (ADR 0041) = Visions; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/multicolor.ts`.
import type { CardDefinition } from "../../types";
export const simoon: CardDefinition = {
    id: "642d9239-82e0-4696-ad99-10796042d1f8", // VIS 136
    rarity: "common",
    name: "Simoon",
    oracleText:
        "Simoon deals 1 damage to each creature target opponent controls.",
    manaCost: { R: 1, G: 1 },
    types: ["Instant"],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                controller: { target: 0 },
                filter: { type: "Creature" },
            },
            effects: [{ op: "dealDamage", amount: 1, to: { ref: "$each" } }],
        },
    ],
};
