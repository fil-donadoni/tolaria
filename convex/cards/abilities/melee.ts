// Melee (CR 702.121).
//
// CR 702.121a — "Melee is a triggered ability. 'Melee' means 'Whenever this
//               creature attacks, it gets +1/+1 until end of turn for each
//               opponent you attacked with a creature this combat.'"
// CR 702.121b — "If a creature has multiple instances of melee, each triggers
//               separately."
//
// Melee reaches a permanent printed or through a grant (Adriana, Captain of the
// Guard), so the trigger comes from the live keyword multiset
// (`liveKeywordTriggers.ts`), never from the definition: each occurrence is one
// instance, which is CR 702.121b.

import type { TriggeredAbility } from "../types";

export const MELEE_KEYWORD = "melee";
export const MELEE_TRIGGER_ID = "melee";

/** CR 702.121a. It triggers on any attack, a planeswalker included; the amount is
 *  what a planeswalker changes, and it is read at resolution, off the record of
 *  the declaration (`combat.attackedPlayerIds`). So any creature's attack counts,
 *  and removing that creature in response takes nothing away. */
export const MELEE_TRIGGER: TriggeredAbility = {
    id: MELEE_TRIGGER_ID,
    oracleText:
        "Melee (Whenever this creature attacks, it gets +1/+1 until end of turn for each opponent you attacked this combat.)",
    event: "ATTACKERS_DECLARED",
    matches: (event, self) =>
        event.type === "ATTACKERS_DECLARED" &&
        event.attackerIds.includes(self.id),
    effects: [
        {
            op: "pump",
            target: { ref: "$source" },
            power: { opponentsAttackedThisCombat: { of: "controller" } },
            toughness: { opponentsAttackedThisCombat: { of: "controller" } },
            duration: { phase: "end-of-turn" },
        },
    ],
};
