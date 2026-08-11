// C21 — green cards, split by colour per ADR 0043. The registry's
// `import * as c21 from "./sets/c21"` resolves through c21/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { PEST_TOKEN } from "../../sharedTokens";

// Pest Infestation — {X}{X}{G} Sorcery (Cube FREE residue token-maker, issue
// #1304, #2369). "Destroy up to X target artifacts and/or enchantments.
// Create twice X 1/1 black and green Pest creature tokens with 'When this
// token dies, you gain 1 life.'" All three former blockers shipped as
// engine primitives ahead of this card (#2364, #2365, #2366) with ZERO card
// consumers — this is the first card to compose them:
//
// - "Destroy up to X target ..." is CR 601.2c's genuinely optional variable
//   target count: `targetRequirement.count: { min: 0, max: "X" }`, resolved
//   by `resolveTargetRequirementCount` (`gre/state.ts`) against the
//   announced `chosenX` into a live `{ min: 0, max: chosenX }` range — X = 0
//   resolves to `{ min: 0, max: 0 }` (zero targets required, spell still
//   legal to cast), and fewer legal targets than X is exactly what "up to"
//   means (no lower bound). The destroy half then iterates the WHOLE
//   announced set via `forEach { set: "targets" }` (the Distorting Wake /
//   Sway of Illusion shape, `inv/blue.ts`) rather than a fixed `{ target: N
//   }` slot, since the number of targets actually chosen varies 0..X.
// - "Create twice X ... tokens" is the `scaled` `EffectValue` member (issue
//   #2366): `{ scaled: { value: { X: true }, times: 2 } }` reads the
//   announced X and doubles it, feeding `createToken`'s `count`.
// - The Pest token's own "When this token dies, you gain 1 life." is the
//   shared `PEST_TOKEN` spec (`cards/sharedTokens.ts`), carrying a literal
//   `EffectTokenSpec.triggeredAbilities` entry (issue #2364) — converted
//   into a real self-scoped `TriggeredAbility` by
//   `resolveTokenTriggeredAbilities` at the `createToken` Op executor.
export const pestInfestation: CardDefinition = {
    id: "4720b4f2-e6af-4223-9250-a0ed21ed5693",
    name: "Pest Infestation",
    rarity: "rare",
    oracleText:
        'Destroy up to X target artifacts and/or enchantments.\nCreate twice X 1/1 black and green Pest creature tokens with "When this token dies, you gain 1 life."',
    manaCost: { X: "X", xFactor: 2, G: 1 },
    types: ["Sorcery"],
    targetRequirement: {
        type: ["Artifact", "Enchantment"],
        count: { min: 0, max: "X" },
    },
    effects: [
        {
            op: "forEach",
            select: { set: "targets" },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
        {
            op: "createToken",
            token: PEST_TOKEN,
            controller: "controller",
            count: { scaled: { value: { X: true }, times: 2 } },
        },
    ],
};
