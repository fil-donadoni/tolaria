// ECL — colorless cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Wistfulness MOVED to `ecl/multicolor.ts` (issue #1927). Its {3}{G/U}{G/U}
// cost makes its colour identity G/U (CR 202.2); its home here was a worklist
// misfile from back when the importer's `parseManaCost` dropped hybrid
// symbols (fixed by #1742/#1771).

export {};
