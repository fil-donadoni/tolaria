// EOE — white cards, split by colour per ADR 0043. The registry's
// `import * as eoe from "./sets/eoe/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Haliya, Guided by Light — {2}{W} Legendary Creature — Human Soldier, 3/3
// (EOE, issue #8652). Three clauses:
//   • "Whenever Haliya or another creature or artifact you control enters" —
//     `scope: "yours"` over a creature-or-artifact filter: Haliya is one of the
//     creatures it reads, the Kappa Cannoneer shape.
//   • "draw a card if you've gained 3 or more life this turn" — the `if` sits
//     INSIDE the effect, so this is not an intervening if (CR 603.4 is the "At
//     [event], if [condition], [effect]" order): it always triggers and asks
//     once, on resolution.
//   • "Warp {W}" — the alternative cost + delayed exile (CR 702.185a).
// hand-tail: "Whenever Haliya or another creature or artifact you control enters, you gain 1 life." (#8652)
// hand-tail: "At the beginning of your end step, draw a card if you've gained 3 or more life this turn." (#8652)
export const haliyaGuidedByLight = defineCard(() => ({
    id: "6f7c63ae-5df3-410f-8643-b8c69133ca9d",
    rarity: "rare",
    name: "Haliya, Guided by Light",
    oracleText:
        "Whenever Haliya or another creature or artifact you control enters, you gain 1 life.\nAt the beginning of your end step, draw a card if you've gained 3 or more life this turn.\nWarp {W} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)",
    manaCost: { X: 2, W: 1 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human", "Soldier"],
    power: 3,
    toughness: 3,
    staticAbilities: ["warp"],
    warp: { id: "warp", description: "Warp {W}", mana: { W: 1 } },
    triggeredAbilities: [
        enteredTrigger({
            id: "haliya-enters-gain-life",
            oracleText:
                "Whenever Haliya or another creature or artifact you control enters, you gain 1 life.",
            scope: "yours",
            filter: { types: ["Creature", "Artifact"] },
            effects: [{ op: "gainLife", player: "controller", amount: 1 }],
        }),
        phaseTrigger({
            id: "haliya-end-step-draw",
            oracleText:
                "At the beginning of your end step, draw a card if you've gained 3 or more life this turn.",
            phase: "END_STEP",
            scope: "your",
            effects: [
                {
                    op: "if",
                    predicate: {
                        left: { lifeGainedThisTurn: { of: "controller" } },
                        op: "ge",
                        right: 3,
                    },
                    then: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        }),
    ],
}));
