// TOR (Torment) — black cards, split by colour per ADR 0043. The registry's
// `import * as tor from "./sets/tor"` resolves through tor/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Cabal Ritual — {1}{B} Instant. "Add {B}{B}{B}. Threshold — Add {B}{B}{B}{B}{B}
// instead if there are seven or more cards in your graveyard." (CR 704.5n
// Threshold ability word — engine infra, no registry row.)
export const cabalRitual: CardDefinition = {
    id: "a5d85875-22da-4054-ae42-e85b472a6d5d",
    rarity: "uncommon",
    name: "Cabal Ritual",
    oracleText:
        "Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "if",
            predicate: {
                left: {
                    count: { zone: "graveyard", controller: "controller" },
                },
                op: "ge",
                right: 7,
            },
            then: [{ op: "addMana", mana: { B: 5 } }],
            else: [{ op: "addMana", mana: { B: 3 } }],
        },
    ],
};
