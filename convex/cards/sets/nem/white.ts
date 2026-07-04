// NEM — white cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// TODO(issue #676 stub — Fading, CR 702.32, is `planned` in
// mechanicsRegistry.ts: no fade-counter/sacrifice-on-depletion primitive
// exists, and Fading is what limits Parallax Wave's repeatable exile mode.
// Stop-and-issue per gre-development.md; tracked stub.
// export const parallaxWave: CardDefinition = {
//     id: "cef789e8-e4cc-4f61-bc15-debc2487777f",
//     name: "Parallax Wave",
//     rarity: "rare",
//     manaCost: { X: 2, W: 2 },
//     types: ["Enchantment"],
// };

export {};
