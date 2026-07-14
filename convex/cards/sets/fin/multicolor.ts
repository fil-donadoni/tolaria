// FIN — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as fin from "./sets/fin"` resolves through fin/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Vivi Ornitier — {1}{U}{R} Legendary Creature — Wizard. "{0}: Add X mana in
// any combination of {U} and/or {R}, where X is Vivi Ornitier's power.
// Activate only during your turn and only once each turn. / Whenever you
// cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it
// deals 1 damage to each opponent." The second ability is free DSL (CR
// 603.2 SPELL_CAST trigger with an `excludeTypes: "Creature"` filter — the
// exact shape already shipped by Third Path Iconoclast, `bro/multicolor.ts`
// — `counters` + `dealDamage` to `{player: "opponent"}`, both already-
// exercised Ops).
//
// #927 SHIPPED (`gre/constants.ts` `getDynamicManaChoices` / `manaAmount`):
// the effective-power READ that originally blocked this card is resolved —
// `manaAmount` / `getManaChoices` now receive the source's CURRENT CR 613.4
// layered power/toughness (counters, anthems, CDAs), not the raw base
// `CardInstanceState.power`. See `mrd/green.ts` (Viridian Joiner) for the
// shipped, fully-activatable regression case.
//
// STILL BLOCKED — a SEPARATE, narrower gap (#1179): Vivi's mana ability has
// NO tap cost ("{0}: ..."), yet needs a runtime {U}/{R} colour-split CHOICE.
// `getManaChoices` / `manaChoices` are only ever consulted through the
// TAP-based activation flow (`tapSourceIntoPayment`, `tapUntap`); the
// non-tap mana-ability mutation (`activateManaAbility`) has no
// `manaChoiceIndex` plumbing at all and always runs the ability's own fixed
// `effect` closure. Do not invent a name / paper over the gap with a
// card-shaped `resolve()` protocol hack — #1179 tracks building the generic
// non-tap choice-based mana activation pathway (shipping only the trigger
// and dropping the mana ability would also be a partial implementation).
// tracked-by: #927, #1179
// export const viviOrnitier: CardDefinition = {
//     id: "ecc1027a-8c07-44a0-bdde-fa2844cff694",
//     name: "Vivi Ornitier",
//     rarity: "mythic",
//     oracleText:
//         "{0}: Add X mana in any combination of {U} and/or {R}, where X is Vivi Ornitier's power. Activate only during your turn and only once each turn.\nWhenever you cast a noncreature spell, put a +1/+1 counter on Vivi Ornitier and it deals 1 damage to each opponent.",
//     manaCost: { X: 1, U: 1, R: 1 },
//     supertypes: ["Legendary"],
//     types: ["Creature"],
//     subtypes: ["Wizard"],
//     power: 0,
//     toughness: 3,
// };

export {};
