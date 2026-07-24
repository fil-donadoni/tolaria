// ZNR — blue cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr"` resolves through znr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Thieving Skydiver — {1}{U} Creature — Merfolk Rogue, 2/1 (Cube FREE wave 3,
// issue #1531/#1525). "Flying\nKicker {X}. X can't be 0.\nWhen this creature
// enters, if it was kicked, gain control of target artifact with mana value
// X or less. If that artifact is an Equipment, attach it to this creature."
// Blocked: this is a VARIABLE-cost Kicker (CR 702.33a — "Pay {X}"), not the
// fixed-cost shape every shipped Kicker card uses (Everflowing Chalice
// `wwk/colorless.ts`, Fire // Ice `eoe/blue.ts`) — `KickerCost.cost` is a
// `ManaCost` that CAN carry the `X: "X"` variable marker structurally, but
// nothing in the cast-time cost pipeline prompts the caster for that value:
// `foldKickerCost` (`convex/game.ts`) calls `normalizeManaCost(cardDef.kicker
// .cost)` with NO `chosenX`, so a variable kicker cost silently folds as if X
// were 0. The bot's move enumeration (`moves.ts`) keys its X-ceiling loop off
// the SPELL's OWN `manaCost.X`, never `kicker.cost.X` — a fixed-cost spell
// with a variable kicker (this card's exact shape) is invisible to it too.
// Already tracked (Verdeloth the Ancient, same gap): tracked-by #1097 item 9.
// export const thievingSkydiver: CardDefinition = {
//     id: "ff84ea71-e477-44f7-a3f8-77fef708efeb",
//     name: "Thieving Skydiver",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Merfolk", "Rogue"],
//     power: 2,
//     toughness: 1,
// };

export {};
