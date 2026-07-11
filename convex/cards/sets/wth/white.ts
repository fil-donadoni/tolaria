// wth — white cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";

// Aura of Silence — {1}{W}{W} Enchantment. "Artifact and enchantment spells
// your opponents cast cost {2} more to cast. Sacrifice this enchantment:
// Destroy target artifact or enchantment." Clause 1 is a CR 601.2f board-wide
// cost increase gated to opponents' artifact/enchantment spells (the Derelor /
// Gloom `cost-modifier` staticEffect pattern, inverted to opponents:
// `card.controllerId !== effectSource.controllerId`). Clause 2 is a CR 605
// activated ability with a self-sacrifice cost and the `destroy` Op (the
// Haywire Mite sac-ability shape, DESTROY instead of exile). Both the
// cost-modifier and `destroy` are already exercised — no hand-written test
// required (per-Op regime, ADR 0046).
export const auraOfSilence: CardDefinition = {
    id: "57e6c366-b8c7-4f66-b8e1-82dc69c0081c",
    rarity: "uncommon",
    name: "Aura of Silence",
    oracleText:
        "Artifact and enchantment spells your opponents cast cost {2} more to cast.\nSacrifice this enchantment: Destroy target artifact or enchantment.",
    manaCost: { X: 1, W: 2 },
    types: ["Enchantment"],
    staticEffects: [
        {
            kind: "cost-modifier",
            appliesToSpell: (card, _ctx, effectSource) =>
                effectSource !== undefined &&
                card.controllerId !== effectSource.controllerId &&
                (card.types.includes("Artifact") ||
                    card.types.includes("Enchantment")),
            costIncrease: { X: 2 },
        },
    ],
    activatedAbilities: [
        {
            id: "aura-of-silence-sac",
            oracleText:
                "Sacrifice this enchantment: Destroy target artifact or enchantment.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: ["Artifact", "Enchantment"],
                count: 1,
            },
            effects: [{ op: "destroy", target: { target: 0 } }],
        },
    ],
};
