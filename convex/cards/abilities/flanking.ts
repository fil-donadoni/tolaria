// Flanking (CR 702.25).
//
// CR 702.25a — "Flanking is a triggered ability that triggers during the
//              declare blockers step. 'Flanking' means 'Whenever this creature
//              becomes blocked by a creature without flanking, the blocking
//              creature gets -1/-1 until end of turn.'"
// CR 702.25b — "If a creature has multiple instances of flanking, each triggers
//              separately."
//
// Flanking reaches a permanent three ways: printed (Mtenda Herder), through a
// static grant (Agility, Sidewinder Sliver) and through a one-shot grant
// (Jabari's Banner), so the trigger comes from the live keyword multiset
// (`liveKeywordTriggers.ts`): each occurrence is one instance, which is CR 702.25b.

import type { TriggeredAbility } from "../types";

export const FLANKING_KEYWORD = "flanking";
export const FLANKING_TRIGGER_ID = "flanking";

/** CR 702.25a. Listens to the per-pair BLOCKERS_CONFIRMED stream, so a creature
 *  double-blocked by two creatures without flanking fires twice and each blocker
 *  gets its own -1/-1.
 *
 *  "Without flanking" is the trigger event's own condition, not an intervening
 *  "if" (CR 603.4), so it is read once: a blocker gaining flanking in response
 *  still gets -1/-1. The pump names the blocker through the event and does not
 *  target (CR 115.1), so shroud and hexproof do not stop it. */
export const FLANKING_TRIGGER: TriggeredAbility = {
    id: FLANKING_TRIGGER_ID,
    oracleText:
        "Flanking (Whenever a creature without flanking blocks this creature, the blocking creature gets -1/-1 until end of turn.)",
    event: "BLOCKERS_CONFIRMED",
    matches: (event, self, state) => {
        if (event.type !== "BLOCKERS_CONFIRMED") return false;
        if (event.attackerId !== self.id) return false;
        const blocker = state?.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === event.blockerId);
        return (
            blocker !== undefined &&
            !blocker.staticAbilities.includes(FLANKING_KEYWORD)
        );
    },
    effects: [
        {
            op: "pump",
            target: { ref: "$event.blockerId" },
            power: -1,
            toughness: -1,
            duration: { phase: "end-of-turn" },
        },
    ],
};
