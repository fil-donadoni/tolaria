// thb — red cards (ADR 0043 colour split).

import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Underworld Breach — {1}{R} Enchantment.
// "Each nonland card in your graveyard has escape. The escape cost is equal to
//  the card's mana cost plus exile three other cards from your graveyard."
//  (CR 702.138 — a zone-wide grant of escape, `grantsEscapeToOwnGraveyard`; the
//  escape module derives each granted card's cost as its own mana cost + exile
//  three other graveyard cards.)
// "At the beginning of the end step, sacrifice this enchantment." (CR 603.6a —
//  a phase-begin self-sacrifice trigger; DSL `sacrifice $source`.)
export const underworldBreach: CardDefinition = {
    id: "0e51d796-7279-4c06-87f0-37adbdaa41df",
    name: "Underworld Breach",
    rarity: "rare",
    oracleText:
        "Each nonland card in your graveyard has escape. The escape cost is equal to the card's mana cost plus exile three other cards from your graveyard. (You may cast cards from your graveyard for their escape cost.)\nAt the beginning of the end step, sacrifice this enchantment.",
    manaCost: { X: 1, R: 1 },
    types: ["Enchantment"],
    // CR 702.138 — grant escape to every nonland card in the controller's
    // graveyard; the granted escape cost exiles three OTHER graveyard cards.
    grantsEscapeToOwnGraveyard: { exileOtherCount: 3 },
    triggeredAbilities: [
        phaseTrigger({
            id: "underworld-breach-end-step-sacrifice",
            oracleText:
                "At the beginning of the end step, sacrifice this enchantment.",
            phase: "END_STEP",
            // "the end step" is unqualified — it fires on each player's end step
            // (CR 500.1); in practice Breach is sacrificed at its controller's
            // own end step, the turn it was cast.
            scope: "each",
            effects: [{ op: "sacrifice", target: { ref: "$source" } }],
        }),
    ],
};
