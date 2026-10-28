// NEO — green cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard, PERMANENT_TYPES } from "../../types";

// Tamiyo's Safekeeping — {G} Instant (NEO, issue #7254, Vintage Cube).
// "Target permanent you control gains hexproof and indestructible until end
// of turn. You gain 2 life."
//
// Authored DSL-first (ADR 0045) out of shipped Ops: two `grantAbility`
// (CR 702.11 hexproof, CR 702.12 indestructible, until end of turn per CR
// 611.2a) on the one target, then `gainLife` (precedent Arwen, Mortal Queen,
// `ltr/multicolor.cards.ts`). The reminder text is not rules text.
// hand-tail: Target permanent you control gains hexproof and indestructible until end of turn (#7254)
export const tamiyosSafekeeping = defineCard(() => ({
    id: "fd4b7ee2-de65-4288-872d-486065a4f226",
    name: "Tamiyo's Safekeeping",
    rarity: "common",
    oracleText:
        "Target permanent you control gains hexproof and indestructible until end of turn. You gain 2 life. (A permanent with hexproof and indestructible can't be the target of spells or abilities your opponents control. Damage and effects that say \"destroy\" don't destroy it.)",
    manaCost: { G: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 1,
        controller: "you",
    },
    effects: [
        {
            op: "grantAbility",
            ability: "hexproof",
            target: { target: 0 },
            duration: { phase: "end-of-turn" },
        },
        {
            op: "grantAbility",
            ability: "indestructible",
            target: { target: 0 },
            duration: { phase: "end-of-turn" },
        },
        { op: "gainLife", player: "controller", amount: 2 },
    ],
}));
