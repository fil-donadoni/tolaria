// ROE — white cards, split by colour per ADR 0043. The registry's
// `import * as roe from "./sets/roe"` resolves through roe/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #1303 residue audit — Oust ("Put target creature into its
// owner's library second from the top. Its controller gains 3 life.") needs
// the `moveZone` Op's `target`-shape to support a battlefield permanent
// moving to the LIBRARY at a specific position. Confirmed absent: the
// interpreter's `moveZone` executor (`convex/gre/effects/interpreter.ts`)
// only implements `to: "hand"` for a `target.type === "permanent"` object
// ("only the bounce-to-hand pair has a plain-move primitive... other
// destinations from the battlefield need leaves-the-battlefield handling and
// are skipped") — no `to: "library"` branch, and no position parameter
// exists anywhere in the Op. Same root gap already tracked for Sunscape
// Apprentice / Nightscape Apprentice ("Put target creature you control on
// top of its owner's library", inv/white.ts + inv/multicolor.ts, item 13 of
// the #1086 decomposition). Stop-and-issue per gre-development.md;
// tracked-by: #1332.
// export const oust: CardDefinition = {
//     id: "07313dd3-d0dc-40ca-98a3-fa4d39e5bcae",
//     name: "Oust",
//     rarity: "uncommon",
//     manaCost: { W: 1 },
//     types: ["Sorcery"],
// };

export {};
