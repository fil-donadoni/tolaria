// CON — green cards, split by colour per ADR 0043. The registry's
// `import * as con from "./sets/con"` resolves through con/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Noble Hierarch — {G} Creature — Human Druid, 0/1. "Exalted (CR 702.83) —
// Whenever a creature you control attacks alone, that creature gets +1/+1
// until end of turn.\n{T}: Add {G}, {W}, or {U}." Vintage Cube mana dork
// (issue #699). The exalted keyword expands to its triggered ability at the
// `getDefinition` seam (convex/cards/abilities/keywordTriggers.ts); the mana
// ability is a CR 605.1a mana ability (useStack: false) offering a colour
// CHOICE at activation via `manaChoices` (the Birds of Paradise pattern).
export const nobleHierarch: CardDefinition = {
    id: "6adfe928-1305-444d-b709-1e714544daaf",
    rarity: "rare",
    name: "Noble Hierarch",
    oracleText:
        "Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)\n{T}: Add {G}, {W}, or {U}.",
    manaCost: { G: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Druid"],
    power: 0,
    toughness: 1,
    staticAbilities: ["exalted"],
    activatedAbilities: [
        {
            id: "noble-hierarch-mana",
            oracleText: "{T}: Add {G}, {W}, or {U}.",
            cost: { tap: true },
            effect: (ctx) => {
                ctx.addMana({ G: 1 });
            },
            useStack: false,
            manaChoices: [{ G: 1 }, { W: 1 }, { U: 1 }],
        },
    ],
};
