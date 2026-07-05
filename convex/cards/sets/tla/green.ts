// TLA — green cards, split by colour per ADR 0043. The registry's
// `import * as tla from "./sets/tla"` resolves through tla/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#917) — Badgermole Cub: keyword **Earthbend** is
// entirely absent from mechanicsRegistry.ts (a new Avatar-set keyword, not a
// CR 702 census entry); "add an additional {G} when you tap a creature for
// mana" is an untracked mana-doubling replacement class. Stop-and-issue per
// gre-development.md rather than an invented mechanism name.
// export const badgermoleCub: CardDefinition = {
//     id: "340c5799-4964-44dd-8c48-8f3f3aba5211",
//     name: "Badgermole Cub",
//     rarity: "mythic",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Badger", "Mole"],
//     power: 2,
//     toughness: 2,
// };

export {};
