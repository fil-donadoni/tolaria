// MID — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as mid from "./sets/mid/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Faithful Mending — {W}{U} Instant. "You gain 2 life, draw two cards, then
// discard two cards.\nFlashback {1}{W}{U}" (modern Scryfall oracle text).
//
// Plain Effect Script (ADR 0045) on already-exercised Ops, run in Oracle
// order: gain 2 life, draw two, then a mandatory two-card hand discard (CR
// 701.9a — the choice Op clamps to hand size). The interpreter checkpoints the
// Op index, so the draw runs once and the discard choice suspends without
// re-drawing — the same loot shape as Faithless Looting (dka/red.cards.ts).
// Flashback (CR 702.34a) is the engine capability in convex/gre/flashback.ts:
// the `flashback` field carries the alternative cost, the on-resolution effect
// is the same script.
// hand-tail: You gain 2 life, draw two cards, then discard two cards. (#8617)
export const faithfulMending = defineCard(() => ({
    id: "50752ca9-ea85-4c4b-9bf5-4f8759a7dcec",
    rarity: "uncommon",
    name: "Faithful Mending",
    oracleText:
        "You gain 2 life, draw two cards, then discard two cards.\nFlashback {1}{W}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)",
    manaCost: { W: 1, U: 1 },
    types: ["Instant"],
    flashback: { X: 1, W: 1, U: 1 },
    effects: [
        { op: "gainLife", player: "controller", amount: 2 },
        { op: "draw", player: "controller", count: 2 },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 2,
            prompt: "Discard two cards.",
            bind: "$discards",
        },
        { op: "discard", player: "controller", cards: { ref: "$discards" } },
    ],
}));
