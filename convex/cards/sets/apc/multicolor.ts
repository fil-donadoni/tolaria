// APC — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { PERMANENT_TYPES } from "../../types";

// Vindicate — "Destroy target permanent." (CR 701.8 destroy.) `type: "any"`
// matches only the CR 115.4 damageable types (creature/planeswalker/battle/
// player); "target permanent" of any type uses the full CR 300.1 permanent-type
// set (incl. Land) instead.
export const vindicate: CardDefinition = {
    id: "2a1bfefd-dae8-49e9-9d56-cc852e3dc93b",
    rarity: "rare",
    name: "Vindicate",
    oracleText: "Destroy target permanent.",
    manaCost: { X: 1, W: 1, B: 1 },
    types: ["Sorcery"],
    targetRequirement: { type: [...PERMANENT_TYPES], count: 1 },
    effects: [{ op: "destroy", target: { target: 0 } }],
};
