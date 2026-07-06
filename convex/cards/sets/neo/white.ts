// NEO — white cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo"` resolves through neo/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#917) — Lion Sash: keyword **Reconfigure** (CR
// 702.151) is `status: "planned"` in mechanicsRegistry.ts — no Equipment-
// reconfigure engine support exists yet. Stop-and-issue per
// gre-development.md rather than an invented/partial implementation.
// export const lionSash: CardDefinition = {
//     id: "3e1766e9-2fa7-4446-a255-7beea1467ece",
//     name: "Lion Sash",
//     rarity: "rare",
//     manaCost: { X: 1, W: 1 },
//     types: ["Artifact", "Creature"],
//     subtypes: ["Equipment", "Cat"],
//     power: 1,
//     toughness: 1,
// };

export {};
