// C15 — red cards, split by colour per ADR 0043. The registry's
// `import * as c15 from "./sets/c15"` resolves through c15/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(stub — "Choose three. You may choose the same mode more than once" is
// a REPEATABLE modal pick (3 picks from 3 modes, with repeats). Neither
// announce-time modal construct carries a count: `CardDefinition.modes`
// (CR 700.2c, the seam a printed modal pick belongs to per ADR 0089) picks
// exactly one, and the resolve-time `optionChoice` Op is deliberately NOT the
// place to add one. A bespoke structural gap, not a named keyword/Op —
// stop-and-issue per gre-development.md rather than an invented mechanism.
// tracked-by: #2266 (cards) via PRD #2261 (modal cardinality grammar)
// export const fieryConfluence: CardDefinition = {
//     id: "7b61c9bc-16e8-417f-99e7-8bd83d4666c5",
//     name: "Fiery Confluence",
//     rarity: "rare",
//     manaCost: { X: 2, R: 2 },
//     types: ["Sorcery"],
// };

export {};
