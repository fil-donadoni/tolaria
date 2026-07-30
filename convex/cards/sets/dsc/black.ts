// DSC — black cards, split by colour per ADR 0043. The registry's
// `import * as dsc from "./sets/dsc"` resolves through dsc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Metamorphosis Fanatic — {4}{B}{B} Creature. "Lifelink. When this creature
// enters, return up to one target creature card from your graveyard to the
// battlefield with a lifelink counter on it. Miracle {1}{B}." Blocked,
// narrowed: the "lifelink counter" grant is GONE as a gap —
// `applyKeywordCounterGrant`/`unapplyKeywordCounterGrant` (`convex/gre/state.ts`,
// via `getKeywordCounterGrant` in `mechanicsRegistry.ts`, issue #1194) is a
// generic keyword-granting-counter mechanism, proven live by Arwen, Mortal
// Queen (`ltr/multicolor.ts`). What remains is only keyword **Miracle**
// (CR 702.94), still `status: "planned"` in `mechanicsRegistry.ts`.
// tracked-by: #1267
// export const metamorphosisFanatic: CardDefinition = {
//     id: "16448d95-ee21-4def-b880-26f6f159c213",
//     name: "Metamorphosis Fanatic",
//     rarity: "rare",
//     manaCost: { X: 4, B: 2 },
//     types: ["Creature"],
//     subtypes: ["Human", "Cleric"],
//     power: 4,
//     toughness: 4,
// };

export {};
