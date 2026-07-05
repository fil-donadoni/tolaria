// C15 — red cards, split by colour per ADR 0043. The registry's
// `import * as c15 from "./sets/c15"` resolves through c15/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — "Choose three. You may choose the same mode more
// than once" is a REPEATABLE modal pick (3 picks from 3 modes, with
// repeats); the `optionChoice` Op is a single fixed pick among modes with no
// repeat-count parameter, and there is no "choose N times" structural
// construct. A bespoke structural gap, not a named keyword/Op — stop-and-
// issue per gre-development.md rather than an invented mechanism. Tracked
// stub.
// export const fieryConfluence: CardDefinition = {
//     id: "7b61c9bc-16e8-417f-99e7-8bd83d4666c5",
//     name: "Fiery Confluence",
//     rarity: "rare",
//     manaCost: { X: 2, R: 2 },
//     types: ["Sorcery"],
// };

export {};
