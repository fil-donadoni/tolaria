// ONS — black cards, split by colour per ADR 0043. The registry's
// `import * as ons from "./sets/ons/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import { defineCard } from "../../types";

// Chain of Smog — {1}{B} Sorcery. "Target player discards two cards. That
// player may copy this spell and may choose a new target for that copy."
//
// Effect Script (ADR 0045): the copier is the spell's own target, read off the
// resolving item's targets, so a retargeted copy offers its next link to the
// new target. The "may" is a cost-free `mayPay` gating `copyResolvingSpell`
// (CR 707.10, CR 707.10c), the composition Chain of Vapor already uses; the
// copy re-runs this script, so the chain recurs until a link declines.
// hand-tail: That player may copy this spell and may choose a new target for that copy (#3657)
export const chainOfSmog = defineCard(() => ({
    id: "6bfe64f9-8b03-41f6-a47b-fade397ad9d1",
    rarity: "uncommon",
    name: "Chain of Smog",
    oracleText:
        "Target player discards two cards. That player may copy this spell and may choose a new target for that copy.",
    manaCost: { X: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: "player", count: 1 },
    effects: [
        {
            op: "choice",
            kind: "discard-hand",
            player: { target: 0 },
            zone: "hand",
            count: 2,
            prompt: "Chain of Smog: choose two cards to discard.",
            bind: "$discards",
        },
        { op: "discard", player: { target: 0 }, cards: { ref: "$discards" } },
        {
            op: "mayPay",
            player: { target: 0 },
            prompt: "That player may copy this spell and may choose a new target for that copy?",
            bind: "$copy",
        },
        {
            op: "if",
            predicate: { binding: "$copy" },
            then: [{ op: "copyResolvingSpell", player: { target: 0 } }],
        },
    ],
}));
