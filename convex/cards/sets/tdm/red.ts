// TDM — red cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm"` resolves through tdm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — Tersa Lightshatter's attack trigger needs to
// "exile a card AT RANDOM from your graveyard": SpellContext has no
// random-pick-from-a-zone primitive (only `discardAtRandom`, which is
// hand-scoped and discards rather than exiles). Composing it would require a
// new primitive, not a reuse of an existing one (gre-development.md
// Primitive reuse checklist) — flagged rather than invented. Stop-and-issue;
// tracked stub.
// export const tersaLightshatter: CardDefinition = {
//     id: "99e96b34-b1c4-4647-a38e-2cf1aedaaace",
//     name: "Tersa Lightshatter",
//     rarity: "rare",
//     manaCost: { X: 2, R: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Orc", "Wizard"],
//     power: 3,
//     toughness: 3,
// };

export {};
