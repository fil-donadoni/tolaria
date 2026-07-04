// KHM — red cards, split by colour per ADR 0043. The registry's
// `import * as khm from "./sets/khm"` resolves through khm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Magda, Brazen Outlaw — "Other Dwarves you control get +1/+0. Whenever a
// Dwarf you control becomes tapped, create a Treasure token. Sacrifice five
// Treasures: Search your library for an artifact or Dragon card, put that
// card onto the battlefield, then shuffle." Blocked: the tutor clause needs
// "type includes Artifact OR subtype includes Dragon" — a disjunction ACROSS
// two different `EffectCardFilter` dimensions, not the OR-WITHIN-one-field
// array support `type`/`subtype`/`color` already have (issue #677). Not a
// `resolve()` card — the anthem + Treasure trigger are trivially DSL, but
// "never ship partial" keeps the whole card as one unit until the filter
// grammar supports this disjunction.
// tracked-by: #897
// export const magdaBrazenOutlaw: CardDefinition = {
//     id: "079e6263-e54c-4899-a336-5315909b9322",
//     name: "Magda, Brazen Outlaw",
//     rarity: "rare",
//     manaCost: { X: 1, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Dwarf", "Berserker"],
//     power: 2,
//     toughness: 1,
// };

export {};
