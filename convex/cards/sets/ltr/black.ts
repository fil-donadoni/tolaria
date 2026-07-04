// LTR — black cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Amass, CR 701.47, is `planned` in
// mechanicsRegistry.ts: no Army-token-creation-or-counter primitive exists.
// Orcish Bowmasters' ETB/draw-punisher damage trigger would be DSL-clean on
// its own, but "amass Orcs 1" is the second half of the same trigger and
// can't be dropped without misrepresenting the card. Stop-and-issue per
// gre-development.md; tracked stub.
// export const orcishBowmasters: CardDefinition = {
//     id: "7c024bae-5631-4e20-ac69-df392ac9e109",
//     name: "Orcish Bowmasters",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Orc", "Archer"],
//     power: 1,
//     toughness: 1,
// };

export {};
