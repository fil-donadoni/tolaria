// DMU — black cards, split by colour per ADR 0043. The registry's
// `import * as dmu from "./sets/dmu"` resolves through dmu/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(needs-triage): implement — needs a new engine capability.
// tracked-by: #674
// export const sheoldredTheApocalypse: CardDefinition = {
//     id: "d67be074-cdd4-41d9-ac89-0a0456c4e4b2",
//     name: "Sheoldred, the Apocalypse",
//     rarity: "mythic",
//     manaCost: { X: 2, B: 2 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Phyrexian", "Praetor"],
//     power: 4,
//     toughness: 5,
// };

export {};
