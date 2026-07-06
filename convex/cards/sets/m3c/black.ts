// M3C — black cards, split by colour per ADR 0043. The registry's
// `import * as m3c from "./sets/m3c"` resolves through m3c/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #679 stub — Barrowgoyf's combat-damage trigger needs Mill
// (CR 701.17): mechanicsRegistry.ts lists it `status: "planned"` — no
// "put the top N library cards into the graveyard" keyword-action primitive
// exists yet (the classifier note on `libraryLook`/`peekLibraryTop` in
// mechanicsRegistry.ts flags the same gap for Millstone/Thought Scour-style
// cards). The Tarmogoyf-style graveyard-card-types P/T half is composable,
// but shipping only that half would misrepresent the card (never ship
// partial — CLAUDE.md). Stop-and-issue per gre-development.md; tracked
// stub.
// export const barrowgoyf: CardDefinition = {
//     id: "f979fc86-2c7e-49b3-965e-607a203cbfb1",
//     name: "Barrowgoyf",
//     rarity: "rare",
//     manaCost: { X: 2, B: 1 },
//     types: ["Creature"],
//     subtypes: ["Lhurgoyf"],
// };

export {};
