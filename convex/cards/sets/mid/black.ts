// MID — black cards, split by colour per ADR 0043. The registry's
// `import * as mid from "./sets/mid"` resolves through mid/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Infernal Grasp — "Destroy target creature. You lose 2 life." (CR 701.7
// destroy; CR 119.3 life loss.)
export const infernalGrasp: CardDefinition = {
    id: "17824929-f131-4b8d-addb-66c25323155e",
    rarity: "uncommon",
    name: "Infernal Grasp",
    oracleText: "Destroy target creature. You lose 2 life.",
    manaCost: { X: 1, B: 1 },
    types: ["Instant"],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "destroy", target: { target: 0 } },
        { op: "loseLife", player: "controller", amount: 2 },
    ],
};
