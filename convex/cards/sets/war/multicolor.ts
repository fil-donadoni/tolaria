// war — multicolor cards (ADR 0043 colour split).

// TODO(issue #679 stub — still blocked, but on a NARROWER gap than before.
// The categorized shared-window half of #1364 HAS since shipped as the
// `revealAndCategorize` Op (reveal a fixed top-N window once, then at most one
// card per category out of that same revealed set, each card claimable by only
// one category — Atraxa, Grand Unifier, one/multicolor.ts, now implemented on
// it). What remains for Niv-Mizzet is the CATEGORY PREDICATE: its ten
// categories are exact colour PAIRS ("a card that's EXACTLY those colors"),
// and `EffectCardFilter.color` is only an OR-any-of-these-colours match with
// no exact-colours mode — a Bant card would wrongly satisfy the WU category.
// `excludeColor` cannot fix it either (excluding the other three colours does
// not require BOTH of W and U to be present). Needs an exact-colours filter
// field before the card can ship; stop-and-issue per gre-development.md.
// tracked-by: #1364.
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
