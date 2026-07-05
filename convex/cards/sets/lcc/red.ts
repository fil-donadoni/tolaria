// LCC — red cards, split by colour per ADR 0043. The registry's
// `import * as lcc from "./sets/lcc"` resolves through lcc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Boast, CR 702.142, is `planned` in
// mechanicsRegistry.ts: no "activate only if this attacked, once per turn"
// activation-timing primitive exists, and Boast is the card's entire
// removal ability. Stop-and-issue per gre-development.md; tracked stub.
// export const broadsideBombardiers: CardDefinition = {
//     id: "ec9df172-9fdb-4b0c-a23a-865b83c8fa40",
//     name: "Broadside Bombardiers",
//     rarity: "rare",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Goblin", "Pirate"],
//     power: 2,
//     toughness: 2,
// };

export {};
