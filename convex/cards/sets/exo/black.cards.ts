// exo — black cards (ADR 0043 colour split).

// Cursed Flesh — {B} Aura. "Enchant creature. Enchanted creature gets -1/-1
// and has fear." (CR 613.4c pt-buff, CR 702.36 fear keyword-grant.)
//
// Home set = earliest paper printing (ADR 0041) = Exodus; it was first
// implemented against the INV reprint, which filed it under the
// wrong home set and rendered the wrong art. That printing now rides along
// as a `CardPrint` in `inv/black.cards.ts`.
import { defineCard, AURA_AFFECTS_HOST } from "../../types";
export const cursedFlesh = defineCard(() => ({
    id: "7433b9bf-ee6e-41fe-b826-0d20584198b1", // EXO 56
    rarity: "common",
    name: "Cursed Flesh",
    oracleText: "Enchant creature\nEnchanted creature gets -1/-1 and has fear.",
    manaCost: { B: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    targetRequirement: { type: "Creature", count: 1 },
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: -1,
            toughness: -1,
        },
        { kind: "keyword-grant", applies: AURA_AFFECTS_HOST, keyword: "fear" },
    ],
}));
