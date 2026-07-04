// PIP — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as pip from "./sets/pip"` resolves through pip/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Monstrosity, CR 701.37, is `planned` in
// mechanicsRegistry.ts: no "put N counters on it and it becomes monstrous"
// primitive exists, and the card's ETB destroy trigger explicitly re-fires
// "or becomes monstrous" — can't be split off faithfully. Stop-and-issue per
// gre-development.md; tracked stub.
// export const alphaDeathclaw: CardDefinition = {
//     id: "ca4c8b04-66af-4cb3-8003-9088d8344b20",
//     name: "Alpha Deathclaw",
//     rarity: "rare",
//     manaCost: { X: 4, B: 1, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Lizard", "Mutant"],
//     power: 6,
//     toughness: 6,
// };

export {};
