// DTK — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as dtk from "./sets/dtk/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
// Kolaghan's Command — {1}{B}{R} Instant. "Choose two —": a fixed count of two
// DISTINCT modes (`modeSelection`, ADR 0094; no repeats clause, CR 700.2d),
// resolved in printed order (CR 608.2c).
// hand-tail: "Choose two —" four-mode bullet list (#2266)
export const kolaghansCommand = defineCard(() => ({
    id: "7c884e1e-fecb-4330-b3de-5fc2a60f7173",
    name: "Kolaghan's Command",
    rarity: "rare",
    oracleText:
        "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan's Command deals 2 damage to any target.",
    manaCost: { X: 1, B: 1, R: 1 },
    types: ["Instant"],
    modeSelection: { min: 2, max: 2 },
    modes: [
        {
            id: "raise",
            label: "Return target creature card from your graveyard to your hand",
            oracleText:
                "Return target creature card from your graveyard to your hand.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [{ op: "moveZone", target: { target: 0 }, to: "hand" }],
        },
        {
            id: "discard",
            label: "Target player discards a card",
            oracleText: "Target player discards a card.",
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "choice",
                    kind: "discard-hand",
                    player: { target: 0 },
                    zone: "hand",
                    count: 1,
                    prompt: "Discard a card.",
                    bind: "$discard",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$discard" },
                },
            ],
        },
        {
            id: "artifact",
            label: "Destroy target artifact",
            oracleText: "Destroy target artifact.",
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
        {
            id: "damage",
            label: "2 damage to any target",
            oracleText: "Kolaghan's Command deals 2 damage to any target.",
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
}));
