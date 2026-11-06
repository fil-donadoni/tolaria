// NEC — white cards, split by colour per ADR 0043. The registry's
// `import * as nec from "./sets/nec/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enchantedPermanentIsVehicle } from "../../abilities/vehicle";

// Swift Reconfiguration — {W} Enchantment — Aura (NEC 10, Vintage Cube, issue
// #7252). "Flash" is a registry-implemented `staticAbilities` keyword (CR 702.8a).
// "Enchant creature or Vehicle" is a type-or-subtype union (CR 702.5a, issue
// #8230): `targetRequirement.typeOrSubtypeFilter` offers the host set and the
// derived `EnchantRestriction.typeOrSubtype` keeps the Aura on a host that stops
// being a creature but is a Vehicle (CR 704.5m). The static clause is
// `enchantedPermanentIsVehicle` (issue #7212): Layer 4 type/subtype rewrite plus
// the Layer 6 crew 5 keyword and ability (CR 301.7, 702.122a, 205.1a, 613.1d).
// hand-tail: Enchanted permanent is a Vehicle artifact with crew N and it loses all other card types (#7252)
export const swiftReconfiguration = defineCard(() => ({
    id: "975dcfab-0281-4fee-92aa-021ea6c524c7", // NEC 10
    rarity: "rare",
    name: "Swift Reconfiguration",
    oracleText:
        "Flash\nEnchant creature or Vehicle\nEnchanted permanent is a Vehicle artifact with crew 5 and it loses all other card types. (It's not a creature unless it's crewed.)",
    manaCost: { W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    staticAbilities: ["Flash"],
    targetRequirement: {
        type: ["Creature", "Artifact"],
        count: 1,
        typeOrSubtypeFilter: { types: ["Creature"], subtypes: ["Vehicle"] },
    },
    ...enchantedPermanentIsVehicle({ name: "Swift Reconfiguration", crew: 5 }),
}));
