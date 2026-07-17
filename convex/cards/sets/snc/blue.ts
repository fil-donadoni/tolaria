// SNC — blue cards, split by colour per ADR 0043. The registry's
// `import * as snc from "./sets/snc"` resolves through snc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// tracked-by: #1343 (residue of #1302, parent PRD #620) — Ledger Shredder.
// "Flying. Whenever a player casts their second spell each turn, this
// creature connives. (Draw a card, then discard a card. If you discarded a
// nonland card, put a +1/+1 counter on this creature.)" `connive` (CR
// 701.50) decomposes fine into `draw` + `discard` + `counters` (all
// `implemented` Ops), but the trigger CONDITION is unbuilt: the engine
// tracks only a single GLOBAL `GameState.spellsCastThisTurn` counter
// (Storm/ADR 0052), with no PER-PLAYER spell-cast-this-turn tally — "a
// player's second spell" needs a per-caster count the global counter can't
// provide (using it directly would be a rules violation, not a
// simplification). Needs a per-player counter + a matching trigger
// condition — see #1343. Left as a tracked stub pending that capability.
// export const ledgerShredder: CardDefinition = {
//     id: "7ea4b5bc-18a4-45db-a56a-ab3f8bd2fb0d",
//     name: "Ledger Shredder",
//     rarity: "rare",
//     manaCost: { X: 1, U: 1 },
//     types: ["Creature"],
//     subtypes: ["Bird", "Advisor"],
//     power: 1,
//     toughness: 3,
// };

export {};
