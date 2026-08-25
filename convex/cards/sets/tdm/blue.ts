// TDM — blue cards, split by colour per ADR 0043. The registry's
// `import * as tdm from "./sets/tdm"` resolves through tdm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Winternight Stories — {2}{U} Sorcery. "Draw three cards. Then discard two
// cards unless you discard a creature card.\nHarmonize {4}{U}"
//
// TRIAGED 2026-08-25 (#1841 audit) — the marker used to read "needs a new
// engine capability" with no gap named. The first line is ordinary card work
// on shipped Ops. The blocker is HARMONIZE, whose Mechanics Registry row is
// `status: "planned"` — a shipped card naming a planned keyword fails Guard A
// catalogue-wide, so the keyword ships first. CR 702.180 harmonize is three
// static abilities: cast from the graveyard for an alternative cost, a
// generic reduction equal to a tapped creature's power, and exile-instead-of-
// anywhere-else. Same family as flashback / retrace / escape / delve, each of
// which already has its own engine module.
// tracked-by: #2764
// export const winternightStories: CardDefinition = {
//     id: "64d9367c-f50c-4568-aa63-6760c44ecaeb",
//     name: "Winternight Stories",
//     rarity: "rare",
//     manaCost: { X: 2, U: 1 },
//     types: ["Sorcery"],
// };

export {};
