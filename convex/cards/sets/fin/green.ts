// FIN — green cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — mill is `planned` (part of the `scryReorder`
// backlog Op): no primitive puts a specific COUNT of library-top cards
// straight into the graveyard as a keyword action. Stop-and-issue per
// gre-development.md; tracked stub.
// export const townGreeter: CardDefinition = {
//     id: "49cd4efa-4df4-4257-9a42-60330f7781e2",
//     name: "Town Greeter",
//     rarity: "common",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Citizen"],
//     power: 1,
//     toughness: 1,
// };

export {};
