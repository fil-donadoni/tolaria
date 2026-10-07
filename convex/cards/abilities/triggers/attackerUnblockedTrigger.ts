// `attackerUnblockedTrigger` — factory for `ATTACKER_UNBLOCKED` triggered
// abilities: "whenever this creature attacks and isn't blocked". CR 509.1h —
// once blockers are declared, every attacker that no creature blocks is
// "unblocked", and the engine emits ONE `ATTACKER_UNBLOCKED` per such attacker
// (`gre/phases.ts`). The event names exactly one creature, so the scope test is
// identity with the source: this factory models the self-subject head only,
// which is the whole of what the Oracle corpus prints ("attacks and isn't
// blocked" always names the creature it is printed on).

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface AttackerUnblockedTriggerArgs {
    id: string;
    oracleText: string;
    /** CR 603.4 check-time predicate. */
    condition?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if, re-checked at resolution. */
    interveningIf?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.3d — targets announced as the trigger goes on the stack. */
    targetRequirement?: TargetRequirement;
    /** Effect Script (ADR 0045). */
    effects: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `ATTACKER_UNBLOCKED`
 *  (CR 509.1h) on the source itself. */
export function attackerUnblockedTrigger(
    args: AttackerUnblockedTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "ATTACKER_UNBLOCKED",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "ATTACKER_UNBLOCKED") return false;
            if (event.attackerId !== self.id) return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        effects: args.effects,
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            event.type === "ATTACKER_UNBLOCKED" && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}
