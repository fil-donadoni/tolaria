// WOE — colorless cards, split by colour per ADR 0043. The registry's
// `import * as woe from "./sets/woe"` resolves through woe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(tracked-by: tolaria#917) — Agatha's Soul Cauldron: "Creatures you
// control with +1/+1 counters on them have all activated abilities of all
// creature cards exiled with [this]" is an ability-copying-from-arbitrary-
// exiled-cards mechanism; "spend mana as though it were mana of any color to
// activate abilities" is a cost-substitution mechanism. Neither exists in
// the Op vocabulary. Stop-and-issue per gre-development.md rather than a
// `resolve()` workaround.
// export const agathasSoulCauldron: CardDefinition = {
//     id: "019b51b0-e5c6-4208-922b-7736686dddcd",
//     name: "Agatha's Soul Cauldron",
//     rarity: "mythic",
//     manaCost: { X: 2 },
//     types: ["Artifact"],
//     supertypes: ["Legendary"],
// };

export {};
