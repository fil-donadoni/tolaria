// Training (CR 702.149).
//
// CR 702.149a — "Training is a triggered ability. 'Training' means 'Whenever this
//               creature and at least one other creature with power greater than
//               this creature's power attack, put a +1/+1 counter on this
//               creature.'"
// CR 702.149b — "If a creature has multiple instances of training, each triggers
//               separately."
// CR 702.149c — "'When this creature trains' means 'When a resolving training
//               ability puts one or more +1/+1 counters on this creature.'"
//
// Training reaches a permanent printed or through a grant, so the trigger comes
// from the live keyword multiset (`liveKeywordTriggers.ts`), never from the
// definition: each occurrence is one instance, which is CR 702.149b.

import { readEffectivePT } from "../effectivePT";
import type {
    CounterAddedEvent,
    EffectOp,
    PermanentView,
    TriggeredAbility,
    TriggerStateView,
} from "../types";
import { counterAddedTrigger } from "./triggers/counterAddedTrigger";

export const TRAINING_KEYWORD = "training";
export const TRAINING_TRIGGER_ID = "training";

const PLUS_ONE_COUNTER = "+1/+1";

/** CR 702.149a — another declared attacker, through the layers on both sides, has
 *  greater power than this one. */
function attacksWithGreaterPower(
    attackerIds: ReadonlyArray<string>,
    self: PermanentView,
    state: TriggerStateView
): boolean {
    const selfPower = readEffectivePT(self, state).power;
    return state.players
        .flatMap((player) => player.battlefield)
        .some(
            (permanent) =>
                permanent.id !== self.id &&
                attackerIds.includes(permanent.id) &&
                readEffectivePT(permanent as unknown as PermanentView, state)
                    .power > selfPower
        );
}

/** CR 702.149a. The power comparison is the trigger event's own condition, not an
 *  intervening "if" (CR 603.4), so it is read once, at the declaration: a pump in
 *  response still leaves the counter to arrive, and so does the partner leaving
 *  combat. A creature put onto the battlefield attacking was never declared, so
 *  it neither triggers nor counts as the partner (CR 508.3a). */
export const TRAINING_TRIGGER: TriggeredAbility = {
    id: TRAINING_TRIGGER_ID,
    oracleText:
        "Training (Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.)",
    event: "ATTACKERS_DECLARED",
    matches: (event, self, state) =>
        event.type === "ATTACKERS_DECLARED" &&
        event.attackerIds.includes(self.id) &&
        state !== undefined &&
        attacksWithGreaterPower(event.attackerIds, self, state),
    effects: [
        {
            op: "counters",
            action: "add",
            counter: PLUS_ONE_COUNTER,
            target: { ref: "$source" },
            count: 1,
        },
    ],
};

/** CR 702.149c — a replacement that leaves no counter announces nothing, so the
 *  creature has not trained, and one that adds to the count is still one event. */
function isTraining(event: CounterAddedEvent): boolean {
    return event.byTriggeredAbilityId === TRAINING_TRIGGER_ID;
}

/** "Whenever this creature trains, …" (CR 702.149c): the engine half a card
 *  printing that line builds on. */
export function trainedTrigger(args: {
    id: string;
    oracleText: string;
    effects: EffectOp[];
}): TriggeredAbility {
    return counterAddedTrigger({
        ...args,
        scope: "self",
        counterType: PLUS_ONE_COUNTER,
        condition: isTraining,
    });
}
