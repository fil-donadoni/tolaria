// LTR — green cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// import type { CardDefinition } from "../../types";

// Delighted Halfling — "{T}: Add {C}.\n{T}: Add one mana of any color. Spend
// this mana only to cast a legendary spell, and that spell can't be
// countered." STOP-AND-ISSUE (tracked-by: #675): the {C} ability is trivial,
// but the second ability needs TWO capabilities this engine doesn't have —
// (1) `ManaRestriction` (`convex/gre/types.ts`) only has `creature-spell` /
// `artifact-spell` / `cumulative-upkeep` variants, keyed off a spell's card
// TYPES; a `legendary-spell` variant would need to key off the SUPERTYPE
// "Legendary" instead, which `restrictionAllowsSpell`'s `spellTypes: readonly
// string[]` parameter doesn't carry today; and (2) "that spell can't be
// countered" has no existing rider on spent restricted mana at all — no
// primitive makes a spell paid for with specific mana uncounterable. Left as
// a tracked stub pending both.
// export const delightedHalfling: CardDefinition = {
//     id: "71384418-173a-4f77-adab-56e52fa23692",
//     name: "Delighted Halfling",
//     rarity: "rare",
//     manaCost: { G: 1 },
//     types: ["Creature"],
//     subtypes: ["Halfling", "Citizen"],
//     power: 1,
//     toughness: 2,
// };
export {};
