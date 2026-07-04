// DMU — white cards, split by colour per ADR 0043. The registry's
// `import * as dmu from "./sets/dmu"` resolves through dmu/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Domain is an uncensused ability word: no
// mechanicsRegistry row, and `StaticCostModifier.costReduction` is a FIXED
// ManaCost, not a dynamic "1 less per basic land type you control" (0-5)
// reducer): Leyline Binding's cost is central to its playability, so a
// faithful implementation needs a variable cost-reduction primitive that
// doesn't exist yet. Its O-Ring-style "exile until this leaves the
// battlefield" ETB would be resolve()-able (Banishing Light precedent,
// jou/white.ts), but Domain blocks the whole card. Stop-and-issue per
// gre-development.md; tracked stub.
// export const leylineBinding: CardDefinition = {
//     id: "3c3ac3dd-35db-447f-8674-37b4680a1ef7",
//     name: "Leyline Binding",
//     rarity: "rare",
//     manaCost: { X: 5, W: 1 },
//     types: ["Enchantment"],
// };

export {};
