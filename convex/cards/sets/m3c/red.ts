// M3C — red cards, split by colour per ADR 0043. The registry's
// `import * as m3c from "./sets/m3c"` resolves through m3c/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — power/toughness dynamically counting card TYPES
// across ALL graveyards (Tarmogoyf-style) has no precedent in this codebase
// (no Tarmogoyf implementation to extend), and the "whenever this or another
// Lhurgoyf you control enters, it deals damage equal to its power to any
// target" reflexive trigger + dynamic-ref damage amount is a second, non-
// trivial piece. Out of scope for a single-card change in this issue — flagging
// for a follow-up rather than building the primitive here. Tracked stub.
// export const pyrogoyf: CardDefinition = {
//     id: "f60be310-4461-4b84-95f0-b2095108bd79",
//     name: "Pyrogoyf",
//     rarity: "rare",
//     manaCost: { X: 3, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Lhurgoyf"],
// };

export {};
