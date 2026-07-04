// ECL — green cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Formidable Speaker — "When this creature enters, you may discard a card.
// If you do, search your library for a creature card, reveal it, put it
// into your hand, then shuffle." Blocked: the optional discard is a COST
// gating the follow-on search ("if you do"), which needs a `discard` leg on
// `mayPay`'s cost union (today: mana/life/sacrifice only) so the search can
// gate on the mayPay outcome via the existing boolean-binding `if` predicate.
// No such leg exists — not a `resolve()` card, a missing-capability
// stop-and-issue case.
// tracked-by: #899
// export const formidableSpeaker: CardDefinition = {
//     id: "265522eb-4f6a-40e7-b374-3833fa63c80b",
//     name: "Formidable Speaker",
//     rarity: "rare",
//     manaCost: { X: 2, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Elf", "Druid"],
//     power: 2,
//     toughness: 4,
// };

export {};
