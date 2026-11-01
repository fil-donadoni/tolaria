// EMN — black cards, split by colour per ADR 0043. The registry's
// `import * as emn from "./sets/emn/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Collective Brutality — {1}{B} Sorcery. "Choose one or more —" is the
// `min..max` range of the mode-list cardinality (ADR 0094); Escalate (CR
// 702.120a, issue #2267) is a `kickers[]` entry of the ADR 0085 family with
// `keyword: "escalate"`, whose count the engine writes from the announced mode
// list ("for each mode you choose beyond the first") — the caster never names
// it. Modes resolve in printed order (CR 608.2c).
// hand-tail: "Escalate—Discard a card." (#2267)
// hand-tail: "Choose one or more —" three-mode bullet list with a reveal-and-choose mode (#2267)
export const collectiveBrutality = defineCard(() => ({
    id: "cb94a02f-4660-45b6-8a39-941b710cf8f3",
    name: "Collective Brutality",
    rarity: "rare",
    oracleText:
        "Escalate—Discard a card. (Pay this cost for each mode chosen beyond the first.)\nChoose one or more —\n• Target opponent reveals their hand. You choose an instant or sorcery card from it. That player discards that card.\n• Target creature gets -2/-2 until end of turn.\n• Target opponent loses 2 life and you gain 2 life.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "escalate",
            keyword: "escalate",
            description: "Escalate—Discard a card",
            hand: {
                action: "discard",
                requirements: [{ filter: {}, count: 1 }],
            },
        },
    ],
    modeSelection: { min: 1, max: 3 },
    modes: [
        {
            id: "duress",
            label: "Target opponent reveals their hand; discard an instant or sorcery",
            oracleText:
                "Target opponent reveals their hand. You choose an instant or sorcery card from it. That player discards that card.",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zoneOwnerId: { target: 0 },
                    zone: "hand",
                    filter: { type: ["Instant", "Sorcery"] },
                    count: 1,
                    prompt: "Choose an instant or sorcery card from that player's hand.",
                    bind: "$picked",
                },
                {
                    op: "discard",
                    player: { target: 0 },
                    cards: { ref: "$picked" },
                },
            ],
        },
        {
            id: "shrink",
            label: "Target creature gets -2/-2 until end of turn",
            oracleText: "Target creature gets -2/-2 until end of turn.",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: -2,
                    toughness: -2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "drain",
            label: "Target opponent loses 2 life and you gain 2 life",
            oracleText: "Target opponent loses 2 life and you gain 2 life.",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                { op: "loseLife", player: { target: 0 }, amount: 2 },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        },
    ],
}));
