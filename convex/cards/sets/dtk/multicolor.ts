// DTK — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as dtk from "./sets/dtk"` resolves through dtk/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Kolaghan's Command — {1}{B}{R} Instant. "Choose two — Return target
// creature card from your graveyard to your hand. / Target player discards a
// card. / Destroy target artifact. / Kolaghan's Command deals 2 damage to any
// target." Blocked: "Choose two —" (two DIFFERENT modes) has no construct —
// `optionChoice`/`EffectMode` (ADR 0045, issue #849) picks exactly ONE mode; a
// "choose N distinct modes" generalization doesn't exist yet (issue #920).
// tracked-by: #920
// export const kolaghansCommand: CardDefinition = {
//     id: "7c884e1e-fecb-4330-b3de-5fc2a60f7173",
//     name: "Kolaghan's Command",
//     rarity: "rare",
//     manaCost: { X: 1, B: 1, R: 1 },
//     types: ["Instant"],
// };

export {};
