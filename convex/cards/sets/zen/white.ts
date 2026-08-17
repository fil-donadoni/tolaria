// ZEN — white cards, split by colour per ADR 0043. The registry's
// `import * as zen from "./sets/zen"` resolves through zen/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";

// Day of Judgment — "Destroy all creatures." (CR 701.8 mass destroy.) The
// first DSL card using the forEach construct (ADR 0045, issue #807 — the
// construct that closes the frozen grammar): the set of creatures is selected
// ONCE at construct entry (CR 608.2i, every player's battlefield — no
// `controller` scope) and each member is destroyed via the `$each` object
// ref. Destroy routes through the replacement layer, so indestructible
// indestructible creatures survive (CR 702.12) and regeneration shields apply — modern
// oracle text carries no "can't be regenerated" rider. Engine simplification
// (flagged): members are destroyed sequentially in APNAP controller order
// rather than simultaneously; a member that leaves the battlefield
// mid-iteration is skipped (CR 608.2b).
//
// Home set = earliest paper printing (ADR 0041) = Zendikar (ZEN 8); it was first
// implemented against the M11 reprint, which filed it under the wrong home
// set and rendered the wrong art. That printing now rides along as a
// `CardPrint` in `m11/white.ts`.
export const dayOfJudgment: CardDefinition = {
    id: "2aa98fca-972b-46c2-bdec-6ace35c988d5", // ZEN 8
    name: "Day of Judgment",
    rarity: "rare",
    oracleText: "Destroy all creatures.",
    manaCost: { X: 2, W: 2 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};
