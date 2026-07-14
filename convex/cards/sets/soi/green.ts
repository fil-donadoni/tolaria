// SOI (Shadows over Innistrad) — green cards, split by colour per ADR 0043.
// The registry's `import * as soi from "./sets/soi"` resolves through
// soi/index.ts. Cards are classified by the colour identity of their mana cost
// (CR 202.2).

// STOP-AND-ISSUE (tracked-by: #1191) — Tireless Tracker: "Landfall — Whenever a
// land you control enters, investigate. (Create a Clue token. It's an artifact
// with '{2}, Sacrifice this token: Draw a card.') Whenever you sacrifice a
// Clue, put a +1/+1 counter on this creature." The Landfall trigger (shared
// `landfallTrigger` factory, #694) is expressible, but Investigate (CR 701.16,
// `status: "planned"` in mechanicsRegistry) needs a Clue token that carries an
// ACTIVATED sac-draw ability (token specs support only keyword statics today)
// plus a "whenever you sacrifice a Clue" trigger. Landfall CAP (#694). Whole
// card left as one stub until #1191 lands.
// export const tirelessTracker: CardDefinition = {
//     id: "ee8e9928-d9b2-4570-adb8-44b34115decd",
//     name: "Tireless Tracker",
//     rarity: "rare",
//     manaCost: { X: 2, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Human", "Scout"],
//     power: 3,
//     toughness: 2,
// };

export {};
