// PLS (Planeshift) — red cards, split by colour per ADR 0043. The registry's
// `import * as pls from "./sets/pls"` resolves through pls/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Flametongue Kavu — {3}{R} Creature — Kavu, 4/2. "When this creature enters,
// it deals 4 damage to target creature." (CR 603.6a self-ETB trigger with a
// CR 603.3d announcement-time target — `enteredTrigger` scope `self` +
// `targetRequirement`, the Fury/#1193 seam. The single-target 4 damage is a
// plain `dealDamage` Op reading the announced slot via `{ target: 0 }`, so
// the effect is DSL-first — no divide-as-you-choose, no `resolve`.) The
// mandatory "target creature" may be Flametongue Kavu itself when it is the
// only creature — self is a legal target, the classic FTK self-kill.
export const flametongueKavu: CardDefinition = {
    id: "e5056bca-bd90-4b50-8630-105558f8ef92", // PLS printing (scryfallId)
    name: "Flametongue Kavu",
    rarity: "uncommon",
    oracleText:
        "When this creature enters, it deals 4 damage to target creature.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 4,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "flametongue-kavu-etb",
            oracleText:
                "When this creature enters, it deals 4 damage to target creature.",
            scope: "self",
            targetRequirement: { type: "Creature", count: 1 },
            effects: [{ op: "dealDamage", amount: 4, to: { target: 0 } }],
        }),
    ],
};
