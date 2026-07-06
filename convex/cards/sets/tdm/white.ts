// TDM — white cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm"` resolves through tdm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #684 stub — Sage of the Skies' defining ability, "When you cast
// this spell, if you've cast another spell this turn, copy this spell,"
// requires spell-copying. Storm (CR 702.40, the closest existing keyword
// census for "copy this spell N times") is `status: "planned"` in
// mechanicsRegistry.ts with zero engine hits — there is no copy-a-spell
// primitive/Op anywhere in the codebase to build on. Flying + lifelink
// (lifelink itself also `planned`/decorative, precedent: avr/black.ts) are
// individually free, but shipping just the vanilla stat line while dropping
// the storm-style copy — the card's entire reason for being in a Cube —
// would misrepresent it (gre-development.md "never ship partial"). Stop-
// and-issue; tracked stub.
// export const sageOfTheSkies: CardDefinition = {
//     id: "6ade6918-6d1d-448d-ab56-93996051e9a9",
//     name: "Sage of the Skies",
//     rarity: "rare",
//     manaCost: { X: 2, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Monk"],
//     power: 2,
//     toughness: 3,
// };

export {};
