// ELD — green cards, split by colour per ADR 0043. The registry's
// `import * as eld from "./sets/eld"` resolves through eld/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — Questing Beast needs "combat damage that would be
// dealt by creatures you control can't be prevented": no unpreventable-
// damage / prevention-immunity primitive exists in the replacement-effect
// system (`convex/gre/replacements.ts`, `combatDamagePrevention.ts`) — every
// existing prevention-side primitive models a damage SHIELD, not immunity to
// one. This is a load-bearing clause of the card (it's what makes Questing
// Beast a premier aggressive threat versus Fog effects), not a corner case
// to simplify away. Stop-and-issue per gre-development.md; tracked stub.
// export const questingBeast: CardDefinition = {
//     id: "e41cf82d-3213-47ce-a015-6e51a8b07e4f",
//     name: "Questing Beast",
//     rarity: "mythic",
//     manaCost: { X: 2, G: 2 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Beast"],
//     power: 4,
//     toughness: 4,
// };

export {};
