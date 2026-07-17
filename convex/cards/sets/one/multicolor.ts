// one — multicolor cards (ADR 0043 colour split).

// TODO(issue #679 stub — `reveal` (a "look at/reveal the top N cards, then
// selectively keep some") is `planned`: the `choice` Op's library zone
// searches the WHOLE library, not a fixed top-N reveal window, so
// "for each card type, put a card of that type from among the revealed
// cards into your hand" has no Op skin. Re-audited under the #1305 residue
// tranche (parent PRD #620, 2026-07-18): the fixed top-N reveal window HAS
// since shipped (`digToHand`, issue #984/#1101), but it only supports ONE
// filter + ONE take count per call, not "for each of several categories, at
// most one card per category, no card reused across categories" against a
// SHARED revealed set — a genuinely new Op shape, not a `digToHand` gap.
// Stop-and-issue per gre-development.md; tracked-by: #1364.
// export const atraxaGrandUnifier: CardDefinition = {
//     id: "4a1f905f-1d55-4d02-9d24-e58070793d3f",
//     name: "Atraxa, Grand Unifier",
//     rarity: "mythic",
//     manaCost: { X: 3, W: 1, U: 1, B: 1, G: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Phyrexian", "Angel"],
//     power: 7,
//     toughness: 7,
// };

export {};
