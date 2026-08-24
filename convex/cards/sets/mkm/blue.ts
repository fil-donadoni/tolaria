// MKM — blue cards, split by colour per ADR 0043. The registry's
// `import * as mkm from "./sets/mkm"` resolves through mkm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Forensic Gadgeteer — {2}{U} Creature — Vedalken Artificer Detective, 2/3.
// "Whenever you cast an artifact spell, investigate. Activated abilities of
// artifacts you control cost {1} less to activate. This effect can't reduce
// the mana in that cost to less than one mana."
//
// TRIAGED 2026-08-25 (#1841 audit) — the marker used to read "needs a new
// engine capability" with no gap named. Half of it is already free: the
// `investigate` keyword action is `status: "implemented"` in the Mechanics
// Registry (the Clue token's activated ability rides
// EffectTokenSpec.activatedAbilities, issue #1191). The one real blocker is
// the second clause: activated-ability cost reduction, with a floor of one
// mana — which #1339 owns for Zirda, the Dawnwaker.
// tracked-by: #1339
// export const forensicGadgeteer: CardDefinition = {
//     id: "97d08a15-e61c-4421-a541-c68a4f87cb74",
//     name: "Forensic Gadgeteer",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Vedalken", "Artificer", "Detective"],
//     power: 2,
//     toughness: 3,
// };

// Proft's Eidetic Memory — {1}{U} Legendary Enchantment. "When this
// enchantment enters, draw a card. You have no maximum hand size. At the
// beginning of combat on your turn, if you've drawn more than one card this
// turn, put X +1/+1 counters on target creature you control, where X is the
// number of cards you've drawn this turn minus one."
//
// TRIAGED 2026-08-25 (#1841 audit) — the marker used to read "needs a new
// engine capability" with no gap named. Two of the three clauses are free:
// the ETB draw is ordinary, and "no maximum hand size" is
// `PlayerState.maxHandSizeOverride: "unlimited"` (the Library of Leng shape,
// consumed by `advancePhase`). The blocker is the third clause's amount:
// `PlayerState.drawnThisTurn` exists as state but no `EffectValue` member
// reads its length, and the "minus one" needs the same value-arithmetic
// construct #1993 is opening. Classified on the living cube tracker.
// tracked-by: #1525
// export const proftsEideticMemory: CardDefinition = {
//     id: "af5b29b3-974c-4200-8df8-b072c11e1600",
//     name: "Proft's Eidetic Memory",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Enchantment"],
//     supertypes: ["Legendary"],
// };

export {};
