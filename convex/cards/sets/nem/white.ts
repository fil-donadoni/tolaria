// NEM — white cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

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

// Seal of Cleansing — {1}{W} Enchantment. "Sacrifice this enchantment:
// Destroy target artifact or enchantment." CR 605 activated ability with a
// self-sacrifice cost (no mana), mirroring Haywire Mite's sacrifice-cost +
// artifact-or-enchantment target shape (bro/colorless.ts) but destroying
// (DSL `destroy` Op, CR 701.8) rather than exiling. The Op is already
// interpreter-exercised — no hand-written test required (per-Op regime,
// ADR 0046).
export const sealOfCleansing: CardDefinition = {
    id: "af6c921e-1b82-412c-9979-adfdf83440f7",
    name: "Seal of Cleansing",
    rarity: "common",
    oracleText:
        "Sacrifice this enchantment: Destroy target artifact or enchantment.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "seal-of-cleansing-sac",
            oracleText:
                "Sacrifice this enchantment: Destroy target artifact or enchantment.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};
