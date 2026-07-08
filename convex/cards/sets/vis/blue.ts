// VIS — blue cards, split by colour per ADR 0043. The registry's
// `import * as vis from "./sets/vis"` resolves through vis/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Impulse — {1}{U} Instant. "Look at the top four cards of your library. Put one
// of them into your hand and the rest on the bottom of your library in any
// order." (CR 401.4 look.) A single already-censused `digToHand` Op (issue #984)
// with look 4 / take 1: it reveals the top four, drives a suspending `look-top`
// pick of one to keep (moved library→hand), and bottoms the remaining three.
// "In any order" is a formality auto-resolved in look order — the bottomed cards
// go face-down into the library, unknown, so no arrangement carries value.
//
// Canonical definition lives in its FIRST-printing set (Visions, VIS 34), per
// the reprint convention (#1008): a card's CardDefinition sits in the earliest
// set that printed it, and later Premodern-legal printings are separate
// CardPrint reprints. The parent issue named `sets/mmq/blue.ts`, but Impulse was
// never printed in Mercadian Masques — Visions is its true first printing (both
// vis and mmq are Premodern-legal).
export const impulse: CardDefinition = {
    id: "9d710a97-062f-4773-b6c6-8aeddeb3b6e8", // VIS 34
    rarity: "common",
    name: "Impulse",
    oracleText:
        "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 1, U: 1 },
    types: ["Instant"],
    effects: [{ op: "digToHand", player: "controller", look: 4, take: 1 }],
};
