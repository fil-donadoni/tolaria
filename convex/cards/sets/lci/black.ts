// LCI — black cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — "as an additional cost, discard a card or pay 3
// life" is a CASTER-CHOSEN alternative additional cost; same gap as Bone
// Shards (mh2/black.ts) — `CardDefinition.additionalCosts` only models ONE
// fixed leg (no "pick cost A or cost B" shape, and no plain discard-a-card
// leg at all). Stop-and-issue per gre-development.md; tracked stub.
// export const bitterTriumph: CardDefinition = {
//     id: "05bdd22c-3e11-4c29-bdfa-d3dfc0e90a9f",
//     name: "Bitter Triumph",
//     rarity: "uncommon",
//     manaCost: { X: 1, B: 1 },
//     types: ["Instant"],
// };

export {};
