// ECL — blue cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";

// Spell Snare — {U} Instant. "Counter target spell with mana value 2."
// (CR 701.6a counter; CR 115.1 spell target.) The target is a spell whose mana
// value is EXACTLY 2, not "2 or less" — `mvFilter.equals`.
// hand-tail: Counter target spell with mana value 2. (#8603)
export const spellSnare = defineCard(() => ({
    id: "35554fdf-c70a-4baa-a35a-414caa9978be",
    name: "Spell Snare",
    rarity: "uncommon",
    oracleText: "Counter target spell with mana value 2.",
    manaCost: { U: 1 },
    types: ["Instant"],
    targetRequirement: { type: "spell", count: 1, mvFilter: { equals: 2 } },
    effects: [{ op: "counter", target: { target: 0 } }],
}));
