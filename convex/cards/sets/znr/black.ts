// ZNR — black cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr"` resolves through znr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Bloodchief's Thirst — "Kicker {2}{B}. Destroy target creature or planeswalker
// with mana value 2 or less. If this spell was kicked, instead destroy target
// creature or planeswalker." (CR 702.33 Kicker.) The kick WIDENS the target set
// (MV ≤ 2 → any), so the effect is a plain destroy and the kicked target set is
// expressed with `kickedTargetRequirement` — announcement swaps in the wider
// requirement (CR 702.33 / 601.2c). Vintage Cube Kicker cluster (issue #692).
export const bloodchiefsThirst: CardDefinition = {
    id: "059e8447-6b1c-4651-a734-a8fea2cbf7b2",
    rarity: "uncommon",
    name: "Bloodchief's Thirst",
    oracleText:
        "Kicker {2}{B} (You may pay an additional {2}{B} as you cast this spell.)\nDestroy target creature or planeswalker with mana value 2 or less. If this spell was kicked, instead destroy target creature or planeswalker.",
    manaCost: { B: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker",
            description: "Kicker {2}{B}",
            mana: { X: 2, B: 1 },
        },
    ],
    // Unkicked: target creature or planeswalker with mana value 2 or less.
    targetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: 1,
        mvFilter: { max: 2 },
    },
    // Kicked: any creature or planeswalker (no mana-value ceiling).
    kickedTargetRequirement: {
        type: ["Creature", "Planeswalker"],
        count: 1,
    },
    effects: [{ op: "destroy", target: { target: 0 } }],
};
