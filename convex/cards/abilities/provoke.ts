// Provoke (CR 702.39).
//
// CR 702.39a — "Provoke is a triggered ability. 'Provoke' means 'Whenever this
//              creature attacks, you may choose to have target creature defending
//              player controls block this creature this combat if able. If you
//              do, untap that creature.'"
// CR 702.39b — "If a creature has multiple instances of provoke, each triggers
//              separately."
//
// Provoke reaches a permanent printed or through a grant (Hunter Sliver), so the
// trigger comes from the live keyword multiset (`liveKeywordTriggers.ts`), never
// from the definition: each occurrence is one instance, which is CR 702.39b.

import type { TriggeredAbility } from "../types";

export const PROVOKE_KEYWORD = "provoke";
export const PROVOKE_TRIGGER_ID = "provoke";

const PROVOKE_CHOICE_BINDING = "$provoke";

/** CR 702.39a. The target is announced as the trigger goes on the stack (CR
 *  603.3d), the choice is made as it resolves (CR 603.5). In 2-player and solo the
 *  defending player (CR 506.2) is the opponent of the ability's controller.
 *
 *  The requirement names this attacker and lasts THIS combat, so an extra combat
 *  phase in the same turn leaves the creature free to block anything. */
export const PROVOKE_TRIGGER: TriggeredAbility = {
    id: PROVOKE_TRIGGER_ID,
    oracleText:
        "Provoke (Whenever this creature attacks, you may have target creature defending player controls untap and block it if able.)",
    event: "ATTACKERS_DECLARED",
    targetRequirement: {
        type: "Creature",
        count: 1,
        controller: "opponent",
    },
    matches: (event, self) =>
        event.type === "ATTACKERS_DECLARED" &&
        event.attackerIds.includes(self.id),
    effects: [
        {
            op: "mayPay",
            player: "controller",
            prompt: "Have the target creature untap and block this creature if able?",
            bind: PROVOKE_CHOICE_BINDING,
        },
        {
            op: "if",
            predicate: { binding: PROVOKE_CHOICE_BINDING },
            then: [
                {
                    op: "restrictCombat",
                    restriction: "must-block",
                    target: { target: 0 },
                    attacker: { ref: "$source" },
                    scope: "combat",
                },
                {
                    op: "tapUntap",
                    action: "untap",
                    target: { target: 0 },
                },
            ],
        },
    ],
};
