// ZEN — blue cards, split by colour per ADR 0043. The registry's
// `import * as zen from "./sets/zen"` resolves through zen/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Spell Pierce — "Counter target noncreature spell unless its controller
// pays {2}." (CR 701.6a counter-unless-pay, CR 117.3a may-pay, CR 114.1
// `spellExcludeTypeFilter` — issue #683's new "noncreature spell" targeting
// restriction). Same mayPay + if(not $paid) + counter shape as Force Spike
// (leg/blue.ts), restricted to noncreature spells at the target-requirement
// level.
export const spellPierce: CardDefinition = {
    id: "cb3d3901-e4a6-45ab-a7b5-c65d91e1875e",
    rarity: "uncommon",
    name: "Spell Pierce",
    oracleText:
        "Counter target noncreature spell unless its controller pays {2}.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellExcludeTypeFilter: "Creature",
    },
    effects: [
        {
            op: "mayPay",
            // CR 117.3a — the spell's controller decides whether to pay.
            player: { controllerOf: { target: 0 } },
            cost: { X: 2 },
            prompt: "Pay {2} to prevent your spell from being countered?",
            bind: "$paid",
        },
        {
            // CR 701.6a — counter unless the payment was made.
            op: "if",
            predicate: { not: { binding: "$paid" } },
            then: [{ op: "counter", target: { target: 0 } }],
        },
    ],
};
