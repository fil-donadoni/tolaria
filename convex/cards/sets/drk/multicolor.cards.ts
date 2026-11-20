// The Dark (DRK), split by colour per ADR 0043. The expansion after Legends
// (119 unique cards); every entry is a CardDefinition — The Dark has zero
// reprints of already-implemented cards, so there are no CardPrint stubs
// (ADR 0014). Modern Scryfall oracle text is authoritative (ADR 0004);
// canonical names / costs / P/T are sourced from MTGJSON `data/json/DRK.json`.
// Generic mana is encoded as `X: n` (e.g. {2}{R} → { X: 2, R: 1 }). Cards are
// classified by the colour identity of their mana cost (CR 202.2); lands and
// artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

export const scarwoodGoblins = defineCard(() => ({
    id: "5542d236-af43-43b8-b30f-8980d74bbdd0",
    rarity: "common",
    name: "Scarwood Goblins",
    oracleText: "",
    manaCost: { R: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
}));
