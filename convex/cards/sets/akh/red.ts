// AKH — red cards, split by colour per ADR 0043. The registry's
// `import * as akh from "./sets/akh"` resolves through akh/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Exert, CR 701.43, is `planned` in
// mechanicsRegistry.ts: no "may exert as it attacks" primitive exists.
// Glorybringer's exert-triggered 4-damage-to-a-creature is the entire
// removal half of the card; omitting it would misrepresent the card. Stop-
// and-issue per gre-development.md; tracked stub.
// export const glorybringer: CardDefinition = {
//     id: "3277ad99-5682-4baa-b106-de15721876a6",
//     name: "Glorybringer",
//     rarity: "rare",
//     manaCost: { X: 3, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Dragon"],
//     power: 4,
//     toughness: 4,
// };

export {};
