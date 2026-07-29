// LTR — red cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Oliphaunt — "Trample. Whenever this creature attacks, another target
// creature you control gets +2/+0 and gains trample until end of turn.
// Mountaincycling {1} ({1}, Discard this card: Search your library for a
// Mountain card, reveal it, put it into your hand, then shuffle.)" Blocked:
// Mountaincycling (CR 702.29c, a `[Subtype]cycling` variant) has no
// Mechanics Registry row at all — plain Cycling is `implemented`, the
// typecycling VARIANT is uncensused and unbuilt.
// Kept as a whole-card stub rather than a partial ship
// (its attack-trigger pump is a distinct, non-tutor-related piece of new
// trigger-factory work tangential to this issue's tutor/fetch scope).
// tracked-by: #1839
// export const oliphaunt: CardDefinition = {
//     id: "6989018c-37b1-4282-a4af-9cc97f160b4d",
//     name: "Oliphaunt",
//     rarity: "common",
//     manaCost: { X: 5, R: 1 },
//     types: ["Creature"],
//     subtypes: ["Elephant"],
//     power: 6,
//     toughness: 4,
// };

export {};
