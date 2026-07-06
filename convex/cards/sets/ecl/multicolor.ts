// ECL — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Vibrance — {3}{R/G}{R/G} Creature. "When this creature enters, if {R}{R}
// was spent to cast it, this creature deals 3 damage to any target. When
// this creature enters, if {G}{G} was spent to cast it, search your library
// for a land card, reveal it, put it into your hand, then shuffle. You gain
// 2 life. Evoke {R/G}{R/G}." Blocked: Evoke (CR 702.74) is `status: planned`
// in mechanicsRegistry.ts, and neither ETB condition is checkable — the
// engine doesn't track WHICH color paid a hybrid cost at cast time (no
// spent-mana-color primitive exists). Home file is `multicolor.ts` (a
// genuine R/G card), NOT `colorless.ts` — the worklist auto-classifier's
// `parseManaCost` drops hybrid `{R/G}` symbols entirely and misfiled it.
// tracked-by: #900
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
//     {3}{G/W}{G/W}{G/W}). Same root gap flagged on Vibrance above
//     (tracked-by #900), which is about hybrid spent-mana tracking
//     specifically — this is the more basic "hybrid pips aren't
//     representable in ManaCost" gap.
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
// card from it. That player discards that card. Evoke {U/B}{U/B}." Blocked:
// same shape as this file's Vibrance stub above — keyword **Evoke** (CR
// 702.74) is `status: "planned"`, AND neither ETB condition is checkable (no
// spent-mana-color primitive tracks WHICH color paid a hybrid cost). Already
// tracked by #900 ("Cube CAP: Evoke keyword + spent-mana-color tracking for
// hybrid ETB triggers"). Home file is `multicolor.ts` (a genuine U/B card,
// hybrid {U/B}{U/B} in its cost), NOT `colorless.ts`.
// tracked-by: #900
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
