// ECL — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Vibrance — {3}{R/G}{R/G} Creature. "When this creature enters, if {R}{R}
// was spent to cast it, this creature deals 3 damage to any target. When
// this creature enters, if {G}{G} was spent to cast it, search your library
// for a land card, reveal it, put it into your hand, then shuffle. You gain
// 2 life. Evoke {R/G}{R/G}." Issue #900 SHIPPED both halves this card
// originally needed: Evoke itself (`CardDefinition.evoke` + `evokeTrigger`,
// see Solitude/Grief in mh2/white.ts / mh2/black.ts) and spent-mana-color
// tracking (`CardInstanceState.notedManaSpentOnCast`, populated at ETB from
// `CardDefinition.noteManaSpent`, readable by a `condition` predicate — the
// exact shape "if {R}{R} was spent" needs). What remains blocking THIS card
// specifically is a DIFFERENT, more basic gap that #900 never covered: its
// printed cost {3}{R/G}{R/G} AND its evoke cost {R/G}{R/G} both need a HYBRID
// mana pip — `ManaCost` (cards/types.ts) has no hybrid-pip representation at
// all (single W/U/B/R/G/C numeric fields only), so the cost can't even be
// declared. Tracked separately at issue #782 ("[engine] Hybrid mana cost
// encoding") — same root gap as Deathrite Shaman (rtr/colorless.ts, #676).
// Home file is `multicolor.ts` (a genuine R/G card), NOT `colorless.ts` — the
// worklist auto-classifier's `parseManaCost` drops hybrid `{R/G}` symbols
// entirely and misfiled it.
// tracked-by: #782
// export const vibrance: CardDefinition = {
//     id: "b9f71c3b-0840-475f-9c17-fdacbc7f3213",
//     name: "Vibrance",
//     rarity: "mythic",
//     manaCost: { X: 3 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 4,
//     toughness: 4,
// };

// TODO(issue #684 stub — Figure of Fable is blocked on TWO independent
// gaps:
//  1. Its printed cost is the hybrid pip {G/W} — ManaCost (cards/types.ts)
//     has no hybrid-pip representation at all (single W/U/B/R/G/C numeric
//     fields only), so the card's mana cost can't even be declared, let
//     alone its three activation costs ({G/W}, {1}{G/W}{G/W},
//     {3}{G/W}{G/W}{G/W}). Same root gap now blocking Vibrance/Deceit above
//     (tracked-by #782) and Wistfulness (ecl/colorless.ts) — the "hybrid pips
//     aren't representable in ManaCost" gap, issue #782.
//  2. Even with a mana-cost workaround, the card's whole mechanic — three
//     activated abilities that PERMANENTLY reclassify the creature's own
//     subtypes and base power/toughness in stages (Kithkin → Kithkin Scout
//     2/3 → Kithkin Soldier 4/5 → Kithkin Avatar 7/8 with "protection from
//     each of your opponents") — has no engine primitive. This is
//     structurally a Level Up/Class-style permanent respec (CR 702.87 Level
//     Up is `status: "planned"`, zero engine hits); layer 7b `staticEffects`
//     handles CONTINUOUS conditional P/T sets, not a one-way staged
//     transformation gated on ability activation history.
// Home file is `multicolor.ts` (a genuine G/W card, not colorless) per the
// Vibrance precedent above. Stop-and-issue; tracked stub.
// export const figureOfFable: CardDefinition = {
//     id: "e0ef33dd-5f6d-48fa-8ef6-a8092868d50f",
//     name: "Figure of Fable",
//     rarity: "rare",
//     types: ["Creature"],
//     subtypes: ["Kithkin"],
//     power: 1,
//     toughness: 1,
// };

// Deceit — {4}{U/B}{U/B} Creature — Elemental Incarnation (Vintage Cube
// edict/discard/hand disruption, issue #682). "When this creature enters, if
// {U}{U} was spent to cast it, return up to one other target nonland
// permanent to its owner's hand. When this creature enters, if {B}{B} was
// spent to cast it, target opponent reveals their hand. You choose a nonland
// card from it. That player discards that card. Evoke {U/B}{U/B}." Same shape
// as this file's Vibrance stub above: issue #900 shipped both Evoke itself and
// spent-mana-color tracking, but this card's printed cost {4}{U/B}{U/B} AND
// its evoke cost {U/B}{U/B} both need a hybrid mana pip, which `ManaCost` has
// no representation for at all — tracked separately at issue #782. Home file
// is `multicolor.ts` (a genuine U/B card, hybrid {U/B}{U/B} in its cost), NOT
// `colorless.ts`.
// tracked-by: #782
// export const deceit: CardDefinition = {
//     id: "bd82c9e4-9871-4e6d-b691-ee00b4b9a3c6",
//     name: "Deceit",
//     rarity: "mythic",
//     manaCost: { X: 4 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 5,
//     toughness: 5,
// };

export {};
