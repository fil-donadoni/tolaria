// war — multicolor cards (ADR 0043 colour split).

// TODO(issue #679 stub — `reveal` (look at the top 10, pick per category) is
// `planned`: the `choice` Op's library zone searches the WHOLE library, not
// a fixed top-N reveal window. Re-audited under the #1305 residue tranche
// (parent PRD #620, 2026-07-18): the fixed top-N reveal window HAS since
// shipped (`digToHand`, issue #984/#1101), but it only supports ONE filter +
// ONE take count per call, not "for each of ten exact-colour-pair
// categories, at most one card per category, no card reused across
// categories" against a SHARED revealed set — a genuinely new Op shape (same
// gap as Atraxa, Grand Unifier, one/multicolor.ts). `EffectCardFilter.color`
// is also only an OR-any-of-these-colors match, not an EXACT-colors-only
// match Niv-Mizzet's "a card that's exactly those colors" needs. Stop-and-
// issue per gre-development.md; tracked-by: #1364.
// export const nivMizzetReborn: CardDefinition = {
//     id: "56a2609d-b535-400b-81d9-72989a33c70f",
//     name: "Niv-Mizzet Reborn",
//     rarity: "mythic",
//     manaCost: { W: 1, U: 1, B: 1, R: 1, G: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Dragon", "Avatar"],
//     power: 6,
//     toughness: 6,
// };

export {};
