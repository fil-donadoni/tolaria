// KTK — blue cards, split by colour per ADR 0043. The registry's
// `import * as ktk from "./sets/ktk/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Stubborn Denial — {U} Instant. "Counter target noncreature spell unless its
// controller pays {1}.\nFerocious — If you control a creature with power 4 or
// greater, counter that spell instead." (CR 701.6a counter, CR 118.12a
// may-pay; "Ferocious" is an ability word with no rules meaning of its own,
// CR 207.2c.) The Spell Pierce shape (zen/blue.cards.ts) with the Ferocious
// clause as an `if` over a battlefield `count` read at RESOLUTION (CR 608.2c
// — the instructions are followed in order, so the board is checked as the
// spell resolves, not at cast): holds → plain `counter`; otherwise the
// `mayPay` + `if (not $paid)` punisher. Only Ops and predicates already
// exercised catalogue-wide.
// hand-tail: Ferocious — If you control a creature with power 4 or greater, counter that spell instead. (#8690)
export const stubbornDenial = defineCard(() => ({
    id: "6f8626c4-306f-4e9d-8840-2bb73fe87e87",
    rarity: "uncommon",
    name: "Stubborn Denial",
    oracleText:
        "Counter target noncreature spell unless its controller pays {1}.\nFerocious — If you control a creature with power 4 or greater, counter that spell instead.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: {
        type: "spell",
        count: 1,
        spellExcludeTypeFilter: "Creature",
    },
    effects: [
        {
            op: "if",
            predicate: {
                left: {
                    count: {
                        zone: "battlefield",
                        controller: "controller",
                        filter: { type: "Creature", powerAtLeast: 4 },
                    },
                },
                op: "ge",
                right: 1,
            },
            then: [{ op: "counter", target: { target: 0 } }],
            else: [
                {
                    op: "mayPay",
                    // CR 118.12a — the spell's controller decides whether to pay.
                    player: { controllerOf: { target: 0 } },
                    cost: { X: 1 },
                    prompt: "Pay {1} to prevent your spell from being countered?",
                    bind: "$paid",
                },
                {
                    // CR 701.6a — counter unless the payment was made.
                    op: "if",
                    predicate: { not: { binding: "$paid" } },
                    then: [{ op: "counter", target: { target: 0 } }],
                },
            ],
        },
    ],
}));
