// `becomesBlockedTrigger` — factory for "whenever this creature becomes
// blocked" triggered abilities. CR 509.3c — a creature "becomes blocked" once
// per combat, however many creatures block it, whereas the engine emits
// `BLOCKERS_CONFIRMED` once per attacker/blocker PAIR (CR 509.1h). The pair
// whose blocker is the FIRST one assigned to the source is the one let
// through (`firstBlockerOf`, the dedupe Rampage already reads). The event
// names the attacker, so the scope test is identity with the source: this
// factory models the self-subject head only.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { firstBlockerOf } from "./rampageTrigger";
import { withTriggerGate } from "./shared";

export interface BecomesBlockedTriggerArgs {
    id: string;
    oracleText: string;
    /** CR 603.4 check-time predicate. */
    condition?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.3d — targets announced as the trigger goes on the stack. */
    targetRequirement?: TargetRequirement;
    /** Effect Script (ADR 0045). */
    effects: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `BLOCKERS_CONFIRMED` where the
 *  source is the blocked attacker, once per combat (CR 509.3c). */
export function becomesBlockedTrigger(
    args: BecomesBlockedTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "BLOCKERS_CONFIRMED",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "BLOCKERS_CONFIRMED") return false;
            if (event.attackerId !== self.id) return false;
            // `state` is undefined only in synthetic test events that push a
            // single pair — treat that as the first pair.
            const first = firstBlockerOf(state, self.id);
            if (first !== undefined && event.blockerId !== first) return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        effects: args.effects,
    };
    return withTriggerGate(ability, args);
}
