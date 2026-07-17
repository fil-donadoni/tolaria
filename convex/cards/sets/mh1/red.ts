// mh1 — red cards (ADR 0043 colour split).

// TODO(issue #1305 stub, parent PRD #620 — Vintage Cube residue tranche,
// 2026-07-18): "When this creature enters, discard two cards, then draw two
// cards. For each nonland card discarded this way, create a 1/1 red
// Elemental creature token." needs a predicate that filters a runtime-
// discovered set (a `choice` Op's discard picks) by CARD TYPE before acting
// per-member. `forEach { set: "bound" }` (ADR 0049, widened issue #1284 to
// accept a `choice` Op's picks binding) has no `filter` field — unlike the
// `permanents`/`graveyard` forEach variants, which do — and `EffectPredicate`
// has no member that tests a bound object against an `EffectCardFilter`
// (only boolean-binding / numeric-comparison / picks-nonempty). The
// activated ability half ("{3}{R}{R}, Exile this card from your graveyard:
// Create two 1/1 red Elemental creature tokens.") is separately clean
// (`activateFromGraveyard` + `exile: true` cost, the Grim Lavamancer shape),
// but never ship a silent partial (CLAUDE.md) — the whole card stays a
// stub. Stop-and-issue per gre-development.md; tracked-by: #1363.
// export const seasonedPyromancer: CardDefinition = {
//     id: "2e139ad1-1079-49e9-babd-6399c44ad333",
//     name: "Seasoned Pyromancer",
//     rarity: "mythic",
//     manaCost: { X: 1, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Human", "Shaman"],
//     power: 2,
//     toughness: 2,
// };

export {};
