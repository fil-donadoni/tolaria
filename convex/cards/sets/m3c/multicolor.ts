// M3C — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as m3c from "./sets/m3c"` resolves through m3c/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// STOP-AND-ISSUE (tracked-by: #1195) — Satya, Aetherflux Genius: "Menace,
// haste. Whenever Satya attacks, create a tapped and attacking token that's a
// copy of up to one other target nontoken creature you control. You get {E}{E}
// (two energy counters). At the beginning of the next end step, sacrifice that
// token unless you pay an amount of {E} equal to its mana value."
//
// The Energy resource (get {E} / pay {E}) shipped in #697 (Cube CAP Energy),
// but Satya is blocked on capabilities BEYOND energy:
//   (1) a token copy that enters TAPPED AND ATTACKING mid-combat (CR 508.4) —
//       `createTokenCopyOf` exists but no path enters a copy attacking;
//   (2) a delayed "sacrifice unless you pay {E} equal to its mana value"
//       (CR 603.7 + 122.1) — needs a `mayPay` energy leg with a runtime amount
//       (the token's mana value) plus reflexive sacrifice-on-decline;
//   (3) an "up to one other target" optional trigger target.
// Left as one stub until #1195 lands — never a partial.
// export const satyaAetherfluxGenius: CardDefinition = {
//     id: "3b964bbe-54cc-425c-9cc6-c877f82af7ba",
//     rarity: "rare",
//     name: "Satya, Aetherflux Genius",
//     oracleText:
//         "Menace, haste\nWhenever Satya attacks, create a tapped and attacking token that's a copy of up to one other target nontoken creature you control. You get {E}{E} (two energy counters). At the beginning of the next end step, sacrifice that token unless you pay an amount of {E} equal to its mana value.",
//     manaCost: { X: 1, U: 1, R: 1, W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Artificer"],
//     supertypes: ["Legendary"],
//     power: 3,
//     toughness: 5,
//     staticAbilities: ["menace", "haste"],
// };

export {};
