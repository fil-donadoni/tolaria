// m11 — white cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Day of Judgment — "Destroy all creatures." (CR 701.8 mass destroy.) The
// first DSL card using the forEach construct (ADR 0045, issue #807 — the
// construct that closes the frozen grammar): the set of creatures is selected
// ONCE at construct entry (CR 608.2i, every player's battlefield — no
// `controller` scope) and each member is destroyed via the `$each` object
// ref. Destroy routes through the replacement layer, so indestructible
// creatures survive (CR 702.12) and regeneration shields apply — modern
// oracle text carries no "can't be regenerated" rider. Engine simplification
// (flagged): members are destroyed sequentially in APNAP controller order
// rather than simultaneously; a member that leaves the battlefield
// mid-iteration is skipped (CR 608.2b).
export const dayOfJudgment: CardDefinition = {
    id: "03f6b25f-d11c-483a-a3e9-6b801d333482",
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
