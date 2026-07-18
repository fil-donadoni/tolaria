// SHM — green cards, split by colour per ADR 0043. The registry's
// `import * as shm from "./sets/shm"` resolves through shm/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #1307 residue re-audit, 2026-07-18 — originally issue #676,
// closed without landing Persist) — Persist, CR 702.79, is still `planned` in
// mechanicsRegistry.ts: no "return with a -1/-1 counter on death" primitive
// exists. The ETB destroy trigger alone would be DSL-clean, but Persist is
// half of the card's identity — shipping without it misrepresents the card.
// Stop-and-issue per gre-development.md; tracked stub. tracked-by: #1372
// (engine: implement Persist keyword, CR 702.79).
// export const woodfallPrimus: CardDefinition = {
//     id: "43aa7e35-55ee-4e02-a8aa-ea2b267055d1",
//     name: "Woodfall Primus",
//     rarity: "rare",
//     manaCost: { X: 5, G: 3 },
//     types: ["Creature"],
//     subtypes: ["Treefolk", "Shaman"],
//     power: 6,
//     toughness: 6,
// };

export {};
