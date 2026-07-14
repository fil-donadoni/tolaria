// MH3 — white cards, split by colour per ADR 0043. The registry's
// `import * as mh3 from "./sets/mh3"` resolves through mh3/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// STOP-AND-ISSUE (tracked-by: #1194) — Guide of Souls: "Whenever another
// creature you control enters, you gain 1 life and get {E} (an energy counter).
// Whenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1
// counters and a flying counter on target attacking creature. It becomes an
// Angel in addition to its other types."
//
// The FIRST ability (gain 1 life + get {E}) is expressible with `gainLife` +
// the `getEnergy` Op shipped in #697 (Cube CAP Energy). The SECOND ability is
// blocked on TWO capabilities the engine does not have:
//   (1) keyword counters that GRANT their ability (CR 122.1c) — a "flying
//       counter" must grant flying, but `gre/layers.ts` recognizes only P/T
//       counters (layer 7d); a keyword counter placed by the `counters` Op is
//       inert;
//   (2) a type-add continuous effect (CR 613.1d, layer 4) — "becomes an Angel
//       in addition to its other types" has no Effect Script Op.
// (It also needs a fixed `{E}` pay cost + reflexive "When you do".) A card must
// be faithful to its WHOLE oracle text, so the whole card is left as one stub
// until #1194 lands — never a partial (memory: full-card-implementation).
// export const guideOfSouls: CardDefinition = {
//     id: "76c3cad2-1e25-4abe-878d-9194de6fcc27",
//     rarity: "rare",
//     name: "Guide of Souls",
//     oracleText:
//         "Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter).\nWhenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a flying counter on target attacking creature. It becomes an Angel in addition to its other types.",
//     manaCost: { W: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Cleric"],
//     power: 1,
//     toughness: 2,
// };

export {};
