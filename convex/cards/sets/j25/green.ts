// J25 (Foundations Jumpstart) — green cards, split by colour per ADR 0043.
// The registry's `import * as j25 from "./sets/j25"` resolves through
// j25/index.ts. Cards are classified by the colour identity of their mana cost
// (CR 202.2).

// STOP-AND-ISSUE (tracked-by: #1189) — Scythecat Cub: "Trample. Landfall —
// Whenever a land you control enters, put a +1/+1 counter on target creature
// you control. If this is the second time this ability has resolved this turn,
// double the number of +1/+1 counters on that creature instead." Trample and
// the base Landfall counter (shared `landfallTrigger` factory, #694) are
// expressible, but the escalation keys on "the SECOND time this ability has
// resolved this turn" — the same per-source per-turn ability-resolution
// counter the engine does not track that blocks Omnath (#1189). Landfall CAP
// (#694). Whole card left as one stub until #1189 lands.
// export const scythecatCub: CardDefinition = {
//     id: "b3dd3c7d-4685-4579-b483-14ddaaaddf5b",
//     name: "Scythecat Cub",
//     rarity: "common",
//     manaCost: { X: 1, G: 1 },
//     types: ["Creature"],
//     subtypes: ["Cat"],
//     power: 2,
//     toughness: 2,
//     staticAbilities: ["trample"],
// };

export {};
