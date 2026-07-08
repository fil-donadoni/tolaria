// LCI — blue cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — Tishana's Tidebinder). The core "counter target
// activated OR triggered ability" engine gap is now CLOSED: Stifle (scg/blue)
// ships the `spellStackKind: "ability"` stack-object kind (keeps any ability,
// activated or triggered) and `ctx.counter` vanishes a countered triggered
// ability (CR 113.7a). What still blocks Tishana specifically is the rest of
// its text — an ETB trigger that ALSO conditionally puts a +1/+1 counter on it
// when the countered ability's source was an artifact/creature/planeswalker —
// which needs a source-type-conditioned follow-up Op, not just the counter.
// Keep tracked stub until that rider is expressible.
// export const tishanasTidebinder: CardDefinition = {
//     id: "907b3d1d-8c85-4707-80b5-c4d832df9846",
//     name: "Tishana's Tidebinder",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Merfolk", "Wizard"],
//     power: 3,
//     toughness: 2,
// };

export {};
