// MID — white cards, split by colour per ADR 0043. The registry's
// `import * as mid from "./sets/mid"` resolves through mid/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Cathar Commando — "Flash. {1}, Sacrifice this creature: Destroy target
// artifact or enchantment." (CR 702.8 flash; CR 701.7 destroy; CR 602.1
// activated ability with a sacrifice-self cost.)
export const catharCommando: CardDefinition = {
    id: "98cbc1c2-b76e-4da3-aa43-00e10b2ce532",
    rarity: "common",
    name: "Cathar Commando",
    oracleText:
        "Flash\n{1}, Sacrifice this creature: Destroy target artifact or enchantment.",
    manaCost: { X: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Soldier"],
    power: 3,
    toughness: 1,
    staticAbilities: ["flash"],
    activatedAbilities: [
        {
            id: "cathar-commando-destroy",
            oracleText:
                "{1}, Sacrifice this creature: Destroy target artifact or enchantment.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};
