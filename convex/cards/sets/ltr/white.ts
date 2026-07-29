// LTR — white cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Eagles of the North — "Flying. When this creature enters, creatures you
// control get +1/+0 and gain first strike until end of turn. Plainscycling
// {1} ({1}, Discard this card: Search your library for a Plains card,
// reveal it, put it into your hand, then shuffle.)" Blocked: Plainscycling
// (CR 702.29c, a `[Subtype]cycling` variant) has no Mechanics Registry row
// at all — plain Cycling is `implemented`, the typecycling variant is
// uncensused and unbuilt. Kept as a whole-card stub rather than a partial
// ship (the ETB team pump is free today).
// tracked-by: #1839
// export const eaglesOfTheNorth: CardDefinition = {
//     id: "c1bd3bc0-77bd-40fe-b4f1-835a04cb6e41",
//     name: "Eagles of the North",
//     rarity: "common",
//     manaCost: { X: 5, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Bird", "Soldier"],
//     power: 3,
//     toughness: 3,
// };

export {};
