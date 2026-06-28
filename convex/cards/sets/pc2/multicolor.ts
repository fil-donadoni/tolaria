// PC2 — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as pc2 from "./sets/pc2"` resolves through pc2/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(needs-triage): implement — needs a new engine capability.
// tracked-by: #674
// export const balefulStrix: CardDefinition = {
//     id: "62090c97-7e3e-4854-bc44-c4a900133ec5",
//     name: "Baleful Strix",
//     rarity: "uncommon",
//     manaCost: { U: 1, B: 1 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Bird"],
//     power: 1,
//     toughness: 1,
// };

export {};
