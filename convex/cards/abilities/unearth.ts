// `unearthAbility` — declarative template for Unearth (CR 702.84).
//
// CR 702.84a: "Unearth [cost]" means "[Cost]: Return this card from your
//   graveyard to the battlefield. It gains haste. Exile it at the beginning of
//   the next end step. If it would leave the battlefield, exile it instead of
//   putting it anywhere else. Activate only as a sorcery."
//
// Not a new Op: a plain graveyard activation over existing seams, every clause
// one Op acting on the object the `moveZone` bound. A card that left the
// graveyard in response binds nothing, so the rest of the script skips it even
// if it has since come back to the battlefield as a new object (CR 400.7).
//
// The haste grant is indefinite and the two exile clauses live outside the
// card's abilities: Humility on the returned creature takes the haste away by
// timestamp and still leaves the end-step exile and the replacement standing,
// and if the delayed trigger is countered the creature stays, hasty, until it
// leaves.

import type { ActivatedAbility, ManaCost } from "../types";
import { keywordCostLabel } from "./keywordCostLabel";

/** Builds the Unearth activated ability (CR 702.84a) for a card whose printed
 *  unearth cost is `cost`. Add the returned ability to the card's
 *  `activatedAbilities`. */
export function unearthAbility(
    cost: ManaCost,
    id = "unearth"
): ActivatedAbility {
    const label = keywordCostLabel(cost);
    return {
        id,
        oracleText:
            `Unearth ${label} (${label}: Return this card from your graveyard to ` +
            `the battlefield. It gains haste. Exile it at the beginning of the ` +
            `next end step or if it would leave the battlefield. Unearth only as ` +
            `a sorcery.)`,
        cost: { mana: cost },
        // CR 702.84a — functions while the card is in a graveyard; "your
        // graveyard" is the owner gate `activateFromGraveyard` carries.
        activateFromGraveyard: true,
        // CR 702.84a — "Activate only as a sorcery" (CR 307.5 timing).
        sorcerySpeedOnly: true,
        // CR 605.1a — not a mana ability: it uses the stack, the card stays in
        // the graveyard until it resolves.
        useStack: true,
        effects: [
            // CR 702.84a — "from your graveyard". The source zone is declared,
            // and a card found anywhere else binds nothing.
            {
                op: "moveZone",
                target: { ref: "$source" },
                from: "graveyard",
                to: "battlefield",
                bind: "$returned",
            },
            {
                op: "grantAbility",
                target: { ref: "$returned" },
                ability: "haste",
            },
            { op: "exileOnLeave", target: { ref: "$returned" } },
            // CR 603.7a — scheduled here, so it fires at the NEXT end step;
            // CR 603.7c — a returned object that left is not followed.
            {
                op: "delayedTrigger",
                timing: "next-end-step",
                oracleText: "Exile it at the beginning of the next end step.",
                capture: { $self: { ref: "$returned" } },
                effects: [{ op: "exile", target: { ref: "$self" } }],
            },
        ],
    };
}
