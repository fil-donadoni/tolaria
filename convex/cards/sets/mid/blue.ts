// MID — blue cards, split by colour per ADR 0043. The registry's
// `import * as mid from "./sets/mid"` resolves through mid/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Consider — {U} Instant. "Surveil 1. Draw a card." (Modern Scryfall oracle
// text.) Authored DSL-first as an Effect Script (ADR 0045) reusing already-
// shipped Ops — the same shape as Opt (inv/blue.ts) with the surveil variant
// of `scryReorder`: Surveil 1 (CR 701.25) is `destination: "graveyard"` —
// look at the top card, keep it on top or put it into the graveyard — then
// draw (CR 121.1). Surveil resolves first, then the draw.
export const consider: CardDefinition = {
    id: "a211d505-4d40-4914-a9da-220770d6ddbc",
    name: "Consider",
    rarity: "common",
    oracleText:
        "Surveil 1. (Look at the top card of your library. You may put it into your graveyard.)\nDraw a card.",
    manaCost: { U: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "scryReorder",
            player: "controller",
            count: 1,
            destination: "graveyard",
            prompt: "Surveil 1 — keep the card on top or put it into your graveyard.",
        },
        { op: "draw", player: "controller", count: 1 },
    ],
};
