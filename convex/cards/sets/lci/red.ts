// LCI — red cards, split by colour per ADR 0043. The registry's
// `import * as lci from "./sets/lci"` resolves through lci/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#917) — Inti, Seneschal of the Sun: both clauses
// need "exile the top card of your library, you may play that card [until
// duration]" (impulse draw) — no Op exists for granting temporary play
// permission from exile (`moveZone`'s exile destination has no such flag).
// The second clause additionally cascades a "whenever you discard one or
// more cards" trigger into the same missing impulse effect. Stop-and-issue
// per gre-development.md rather than a `resolve()` workaround.
// export const intiSeneschalOfTheSun: CardDefinition = {
//     id: "fa7a55aa-ae61-4933-b7a4-dcc55dac6fcd",
//     name: "Inti, Seneschal of the Sun",
//     rarity: "rare",
//     manaCost: { X: 1, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Human", "Knight"],
//     power: 2,
//     toughness: 2,
// };

export {};
