// DSC — black cards, split by colour per ADR 0043. The registry's
// `import * as dsc from "./sets/dsc"` resolves through dsc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Metamorphosis Fanatic — {4}{B}{B} Creature. "Lifelink. When this creature
// enters, return up to one target creature card from your graveyard to the
// battlefield with a lifelink counter on it. Miracle {1}{B}." Blocked: keyword
// **Miracle** (CR 702.94) is `status: "planned"` in mechanicsRegistry.ts, and
// the "lifelink counter" grant has no generalized counter-driven-ability-grant
// mechanism (issue #920).
// tracked-by: #920
// export const metamorphosisFanatic: CardDefinition = {
//     id: "16448d95-ee21-4def-b880-26f6f159c213",
//     name: "Metamorphosis Fanatic",
//     rarity: "rare",
//     manaCost: { X: 4, B: 2 },
//     types: ["Creature"],
//     subtypes: ["Human", "Cleric"],
//     power: 4,
//     toughness: 4,
// };

export {};
