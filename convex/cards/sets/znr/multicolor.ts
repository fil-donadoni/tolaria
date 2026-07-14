// ZNR — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as znr from "./sets/znr"` resolves through znr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// STOP-AND-ISSUE (tracked-by: #1189) — Omnath, Locus of Creation: "When Omnath
// enters, draw a card. Landfall — Whenever a land you control enters, you gain
// 4 life if this is the FIRST time this ability has resolved this turn. If it's
// the SECOND time, add {R}{G}{W}{U}. If it's the THIRD time, Omnath deals 4
// damage to each opponent and each planeswalker you don't control." The ETB
// draw and the Landfall trigger (shared `landfallTrigger` factory, #694) are
// expressible, but the escalation keys on "the Nth time this ability has
// resolved this turn" — a per-source per-turn ability-resolution counter the
// engine does not track (no Op / EffectValue / state field). Landfall CAP
// (#694). Whole card left as one stub until #1189 lands.
// export const omnathLocusOfCreation: CardDefinition = {
//     id: "4e4fb50c-a81f-44d3-93c5-fa9a0b37f617",
//     name: "Omnath, Locus of Creation",
//     rarity: "mythic",
//     manaCost: { R: 1, G: 1, W: 1, U: 1 },
//     types: ["Creature"],
//     supertypes: ["Legendary"],
//     subtypes: ["Elemental"],
//     power: 4,
//     toughness: 4,
// };

export {};
