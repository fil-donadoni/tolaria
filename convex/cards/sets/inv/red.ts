// INV — red cards, split by colour per ADR 0043. The registry's
// `import * as inv from "./sets/inv"` resolves through inv/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Overload — "Kicker {2}. Destroy target artifact if its mana value is 2 or
// less. If this spell was kicked, destroy that artifact if its mana value is 5
// or less instead." (CR 702.33 Kicker — the on-resolution effect is DSL; only
// the optional additional cost lives in the engine `kicker` field.) The MV
// threshold, not the target set, changes with the kick, so there is no
// `kickedTargetRequirement`: the spell always targets an artifact and the
// `manaValue` value member (CR 202.3) gates the destroy at resolution.
// Vintage Cube Kicker cluster (issue #692, ADR 0041).
export const overload: CardDefinition = {
    id: "c91fca91-7296-422e-b251-d571b710ff71",
    rarity: "common",
    name: "Overload",
    oracleText:
        "Kicker {2} (You may pay an additional {2} as you cast this spell.)\nDestroy target artifact if its mana value is 2 or less. If this spell was kicked, destroy that artifact if its mana value is 5 or less instead.",
    manaCost: { R: 1 },
    types: ["Instant"],
    kicker: { cost: { X: 2 } },
    targetRequirement: { type: "Artifact", count: 1 },
    effects: [
        {
            op: "if",
            predicate: { left: { kickerCount: true }, op: "ge", right: 1 },
            then: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: { target: 0 } } },
                        op: "le",
                        right: 5,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
            else: [
                {
                    op: "if",
                    predicate: {
                        left: { manaValue: { of: { target: 0 } } },
                        op: "le",
                        right: 2,
                    },
                    then: [{ op: "destroy", target: { target: 0 } }],
                },
            ],
        },
    ],
};
