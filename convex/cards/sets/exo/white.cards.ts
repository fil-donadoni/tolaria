// exo — white cards (ADR 0043 colour split).

// Shackles — "Enchant creature. Enchanted creature doesn't untap during its
// controller's untap step. {W}: Return this Aura to its owner's hand."
//
// Home set = earliest paper printing (ADR 0041) = Exodus; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/white.ts`.
import type { CardDefinition } from "../../types";
import { AURA_AFFECTS_HOST } from "../../types";
export const shackles: CardDefinition = {
    id: "c5315668-b8ef-49ab-a8f5-144adc7bcd84", // EXO 18
    rarity: "common",
    name: "Shackles",
    oracleText:
        "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step.\n{W}: Return this Aura to its owner's hand.",
    manaCost: { X: 2, W: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "does-not-untap",
        },
    ],
    activatedAbilities: [
        {
            id: "shackles-return",
            oracleText: "{W}: Return this Aura to its owner's hand.",
            cost: { mana: { W: 1 } },
            useStack: true,
            effects: [
                { op: "moveZone", target: { ref: "$source" }, to: "hand" },
            ],
        },
    ],
};
