// ONS — blue cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import { defineCard, PERMANENT_TYPES } from "../../types";

// Chain of Vapor — {U} Instant. "Return target nonland permanent to its
// owner's hand. Then that permanent's controller may sacrifice a land of their
// choice. If the player does, they may copy this spell and may choose a new
// target for that copy."
//
// Effect Script (ADR 0045): the bounce binds the permanent so its controller
// is read as last-known information after it leaves the battlefield (CR
// 608.2h); the sacrifice is a `mayPay` permanent cost leg (CR 701.21a); the
// copy is a second, cost-free `mayPay` gating `copyResolvingSpell` (CR 707.10,
// CR 707.10c). The copy re-runs this script, so the chain can recur.
export const chainOfVapor = defineCard(() => ({
    id: "30f6b4a2-5780-46e9-b239-459d2cf37743",
    rarity: "uncommon",
    name: "Chain of Vapor",
    oracleText:
        "Return target nonland permanent to its owner's hand. Then that permanent's controller may sacrifice a land of their choice. If the player does, they may copy this spell and may choose a new target for that copy.",
    manaCost: { U: 1 },
    types: ["Instant"],
    // "target nonland permanent": the full CR 300.1 permanent-type set (as
    // Boomerang uses for "target permanent") minus Land via `excludeTypes`
    // ("any" alone matches only the CR 115.4 damageable types).
    targetRequirement: {
        type: [...PERMANENT_TYPES],
        count: 1,
        excludeTypes: "Land",
    },
    effects: [
        {
            op: "moveZone",
            target: { target: 0 },
            to: "hand",
            bind: "$that1",
        },
        {
            op: "mayPay",
            player: { ref: "$that1.controller" },
            cost: {
                permanent: {
                    action: "sacrifice",
                    filter: { types: "Land" },
                    count: 1,
                },
            },
            prompt: "That permanent's controller may sacrifice a land of their choice?",
            bind: "$paid2",
        },
        {
            op: "if",
            predicate: { binding: "$paid2" },
            then: [
                {
                    op: "mayPay",
                    player: { ref: "$that1.controller" },
                    prompt: "They may copy this spell and may choose a new target for that copy?",
                    bind: "$copy3",
                },
                {
                    op: "if",
                    predicate: { binding: "$copy3" },
                    then: [
                        {
                            op: "copyResolvingSpell",
                            player: { ref: "$that1.controller" },
                        },
                    ],
                },
            ],
        },
    ],
}));
