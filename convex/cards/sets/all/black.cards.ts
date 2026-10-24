// ALL (Alliances) — black cards, split by colour per ADR 0043. The registry's
// `import * as all from "./sets/all/index.cards"` re-exports this module.
import { defineCard } from "../../types";
import { creatureCardDirectlyAboveInGraveyard } from "../../graveyardOrder";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Krovikan Horror — {3}{B} Creature — Horror Spirit, 2/2 (ALL 53).
// "At the beginning of the end step, if this card is in your graveyard with a
// creature card directly above it, you may return this card to your hand.
// {1}, Sacrifice a creature: This creature deals 1 damage to any target."
//
//   * End-step recursion — a `zone: "graveyard"` `phaseTrigger`, `scope: "each"`
//     (every end step, CR 513.1a), the Pyre Zombie shape (`inv/multicolor`):
//     the ability functions from the graveyard because it moves the card out
//     of that zone (CR 113.6m). "If this card is in your graveyard with a
//     creature card directly above it" is an intervening-if (CR 603.4),
//     declared as `interveningIf` so it is re-checked as the ability resolves.
//     "Directly above" is the adjacent higher index in the pile (CR 404.2).
//     The cost-free `mayPay` is the bare "you may" decision (issue #680).
//   * Sacrifice for damage — the sacrificed creature is a COST (CR 602.1,
//     118.1), then a single `dealDamage` to the announced any-target
//     (CR 120.1); the source of the damage is this creature (last-known
//     information if it sacrificed itself, CR 608.2h).
//
// compiler-gap: "At the beginning of the end step, if this card is in your graveyard with a creature card directly above it, you may return this card to your hand." (#5223)
export const krovikanHorror = defineCard(() => ({
    id: "e1f3cb1c-6bde-4b55-b5bc-5b64b56930f2", // ALL 53
    rarity: "rare",
    name: "Krovikan Horror",
    oracleText:
        "At the beginning of the end step, if this card is in your graveyard with a creature card directly above it, you may return this card to your hand.\n{1}, Sacrifice a creature: This creature deals 1 damage to any target.",
    manaCost: { X: 3, B: 1 },
    types: ["Creature"],
    subtypes: ["Horror", "Spirit"],
    power: 2,
    toughness: 2,
    triggeredAbilities: [
        phaseTrigger({
            id: "krovikan-horror-end-step-return",
            oracleText:
                "At the beginning of the end step, if this card is in your graveyard with a creature card directly above it, you may return this card to your hand.",
            phase: "END_STEP",
            scope: "each",
            zone: "graveyard",
            interveningIf: (_event, self, state) =>
                creatureCardDirectlyAboveInGraveyard(state, self),
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Return Krovikan Horror to your hand?",
                    bind: "$return",
                },
                {
                    op: "if",
                    predicate: { binding: "$return" },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "krovikan-horror-sac-damage",
            oracleText:
                "{1}, Sacrifice a creature: This creature deals 1 damage to any target.",
            cost: { mana: { X: 1 }, sacrificeFilter: { types: "Creature" } },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
        },
    ],
}));
