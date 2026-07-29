// LTR — black cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Amass, CR 701.47, is `planned` in
// mechanicsRegistry.ts: no Army-token-creation-or-counter primitive exists.
// Orcish Bowmasters' ETB/draw-punisher damage trigger would be DSL-clean on
// its own, but "amass Orcs 1" is the second half of the same trigger and
// can't be dropped without misrepresenting the card. Stop-and-issue per
// gre-development.md; tracked stub.
// export const orcishBowmasters: CardDefinition = {
//     id: "7c024bae-5631-4e20-ac69-df392ac9e109",
//     name: "Orcish Bowmasters",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Orc", "Archer"],
//     power: 1,
//     toughness: 1,
// };

// Troll of Khazad-dûm — "This creature can't be blocked except by three or
// more creatures. Swampcycling {1} ({1}, Discard this card: Search your
// library for a Swamp card, reveal it, put it into your hand, then
// shuffle.)" Blocked: Swampcycling (CR 702.29c, a `[Subtype]cycling` variant)
// has no Mechanics Registry row at all — plain Cycling is `implemented`, the
// typecycling variant is uncensused and unbuilt.
// Kept as a whole-card stub rather than a
// partial ship (its "can't be blocked except by three or more creatures"
// static is a generalization of the existing menace minimum-blocker
// threshold, `gre/combat.ts` `getMinimumBlockers` — distinct, non-tutor-
// related combat-system work tangential to this issue's tutor/fetch scope).
// tracked-by: #1839
// export const trollOfKhazadDum: CardDefinition = {
//     id: "a6539e26-b63b-4725-9407-caaf451de084",
//     name: "Troll of Khazad-dûm",
//     rarity: "common",
//     manaCost: { X: 5, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Troll"],
//     power: 6,
//     toughness: 5,
// };

export {};
