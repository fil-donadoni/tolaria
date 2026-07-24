// C21 — red cards, split by colour per ADR 0043. The registry's
// `import * as c21 from "./sets/c21"` resolves through c21/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: #1558) — Laelia, the Blade Reforged: re-audited for
// issue #1527 (Cube FREE wave 3: keyword-residue creatures). Its FIRST
// ability ("exile the top card of your library, you may play that card this
// turn") is now free — the impulse-draw protocol (no Op skin, precedent
// Elkin Bottle / Ice Cauldron, ice/colorless.ts) shipped for Ragavan /
// Inti / Robber of the Rich covers it. Still blocked on the SECOND ability:
// "whenever one or more cards are put into exile from your library and/or
// graveyard" has no matching `GameEventType` — confirmed by re-grep, no
// engine call site emits any such event (a genuinely new capability, not a
// keyword). Stop-and-issue per gre-development.md rather than shipping
// half the card; split to #1558 rather than a `resolve()` workaround.
// export const laeliaTheBladeReforged: CardDefinition = {
//     id: "a3bb2881-e8fb-4fba-a9f9-d93e6ca24378",
//     name: "Laelia, the Blade Reforged",
//     rarity: "rare",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Spirit", "Warrior"],
//     power: 2,
//     toughness: 2,
// };

export {};
