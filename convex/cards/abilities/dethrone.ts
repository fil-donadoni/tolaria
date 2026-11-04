// Dethrone (CR 702.105).
//
// CR 702.105a — "Dethrone is a triggered ability. 'Dethrone' means 'Whenever this
//               creature attacks the player with the most life or tied for most
//               life, put a +1/+1 counter on this creature.'"
// CR 702.105b — "If a creature has multiple instances of dethrone, each triggers
//               separately."
//
// Dethrone reaches a permanent printed or through a grant, so the trigger comes
// from the live keyword multiset (`liveKeywordTriggers.ts`), never from the
// definition: each occurrence is one instance, which is CR 702.105b.

import type { TriggeredAbility, TriggerStateView } from "../types";

export const DETHRONE_KEYWORD = "dethrone";
export const DETHRONE_TRIGGER_ID = "dethrone";

/** CR 508.3a — "attacks [a player]" reads the declared defender: an entry in
 *  `combat.attackTargets` names a planeswalker or battle, and its absence the
 *  defending player, who is the attacker's controller's one opponent here. */
function attacksPlayerWithMostLife(
    state: TriggerStateView,
    attacker: { id: string; controllerId: string }
): boolean {
    if (state.combat?.attackTargets?.[attacker.id] !== undefined) return false;
    const defender = state.players.find((p) => p.id !== attacker.controllerId);
    return (
        defender !== undefined &&
        state.players.every((player) => player.life <= defender.life)
    );
}

/** CR 702.105a. The life totals are the trigger event's own condition, not an
 *  intervening "if" (CR 603.4), so they are read once, at the declaration: a life
 *  change in response still leaves the counter to arrive. */
export const DETHRONE_TRIGGER: TriggeredAbility = {
    id: DETHRONE_TRIGGER_ID,
    oracleText:
        "Dethrone (Whenever this creature attacks the player with the most life or tied for most life, put a +1/+1 counter on it.)",
    event: "ATTACKERS_DECLARED",
    matches: (event, self, state) =>
        event.type === "ATTACKERS_DECLARED" &&
        event.attackerIds.includes(self.id) &&
        state !== undefined &&
        attacksPlayerWithMostLife(state, self),
    effects: [
        {
            op: "counters",
            action: "add",
            counter: "+1/+1",
            target: { ref: "$source" },
            count: 1,
        },
    ],
};
