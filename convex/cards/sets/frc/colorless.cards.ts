// FRC — colorless cards, split by colour per ADR 0043. The registry's
// `import * as frc from "./sets/frc/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";
import { GINGERBRUTE_TOKEN } from "../../sharedTokens";

// Ginger, Queen of Sweets — {6} Legendary Artifact Creature — Food Noble, 6/4
// (Vintage Cube, issue #8173). "When Ginger enters, you become the monarch.
// {2}, {T}, Sacrifice Ginger: You gain 6 life. At the beginning of each
// upkeep, if you're the monarch, create a Gingerbrute token."
//   - The ETB is a plain `becomeMonarch` Op (CR 725.1).
//   - The sacrifice-for-life is an activated ability whose cost sacrifices its
//     own source (CR 602.1, `sacrifice: true`).
//   - The upkeep clause is a `phaseTrigger` with scope `each` (CR 503.1a — every
//     player's upkeep) whose CR 603.4 intervening-if reads the ABILITY'S
//     controller, not the step's active player: `interveningIf` is checked as
//     the trigger would trigger and again as it resolves, against
//     `TriggerStateView.monarchId` (CR 725.1). The token is the shared
//     Gingerbrute spec (CR 111.3), created under the ability's controller.
// hand-tail: Create a Gingerbrute token (#8173)
export const gingerQueenOfSweets = defineCard(() => ({
    id: "f4ff6bf9-89a9-4c2a-84a2-d4ceb7168adf",
    name: "Ginger, Queen of Sweets",
    rarity: "rare",
    oracleText:
        'When Ginger enters, you become the monarch.\n{2}, {T}, Sacrifice Ginger: You gain 6 life.\nAt the beginning of each upkeep, if you\'re the monarch, create a Gingerbrute token. (It\'s a {1} 1/1 Food Golem artifact creature with haste, "{1}: This token can\'t be blocked this turn except by creatures with haste," and "{2}, {T}, Sacrifice this token: You gain 3 life.")',
    manaCost: { X: 6 },
    supertypes: ["Legendary"],
    types: ["Artifact", "Creature"],
    subtypes: ["Food", "Noble"],
    power: 6,
    toughness: 4,
    triggeredAbilities: [
        enteredTrigger({
            id: "ginger-queen-of-sweets-monarch",
            oracleText: "When Ginger enters, you become the monarch.",
            scope: "self",
            effects: [{ op: "becomeMonarch" }],
        }),
        phaseTrigger({
            id: "ginger-queen-of-sweets-upkeep",
            oracleText:
                "At the beginning of each upkeep, if you're the monarch, create a Gingerbrute token.",
            phase: "UPKEEP",
            scope: "each",
            interveningIf: (_event, self, state) =>
                state?.monarchId !== undefined &&
                state.monarchId === self.controllerId,
            effects: [
                {
                    op: "createToken",
                    token: GINGERBRUTE_TOKEN,
                    controller: "controller",
                },
            ],
        }),
    ],
    activatedAbilities: [
        {
            id: "ginger-queen-of-sweets-sacrifice-gain-life",
            oracleText: "{2}, {T}, Sacrifice Ginger: You gain 6 life.",
            cost: { mana: { X: 2 }, tap: true, sacrifice: true },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 6 }],
        },
    ],
}));
