// ECL — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as ecl from "./sets/ecl"` resolves through ecl/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

// Vibrance — {3}{R/G}{R/G} Creature. "When this creature enters, if {R}{R}
// was spent to cast it, this creature deals 3 damage to any target. When
// this creature enters, if {G}{G} was spent to cast it, search your library
// for a land card, reveal it, put it into your hand, then shuffle. You gain
// 2 life. Evoke {R/G}{R/G}." Blocked: Evoke (CR 702.74) is `status: planned`
// in mechanicsRegistry.ts, and neither ETB condition is checkable — the
// engine doesn't track WHICH color paid a hybrid cost at cast time (no
// spent-mana-color primitive exists). Home file is `multicolor.ts` (a
// genuine R/G card), NOT `colorless.ts` — the worklist auto-classifier's
// `parseManaCost` drops hybrid `{R/G}` symbols entirely and misfiled it.
// tracked-by: #900
// export const vibrance: CardDefinition = {
//     id: "b9f71c3b-0840-475f-9c17-fdacbc7f3213",
//     name: "Vibrance",
//     rarity: "mythic",
//     manaCost: { X: 3 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 4,
//     toughness: 4,
// };

export {};
