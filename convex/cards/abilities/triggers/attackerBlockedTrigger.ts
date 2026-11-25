// `attackerBlockedTrigger` — factory for `ATTACKER_BLOCKED` triggered
// abilities: "whenever this creature becomes blocked". CR 509.3c — it triggers
// only once each combat for that creature, even if it is blocked by multiple
// creatures. The engine emits ONE `ATTACKER_BLOCKED` per blocked attacker
// (`gre/phases.ts`), which IS that rule; the per-pair `BLOCKERS_CONFIRMED`
// (CR 509.3d, "becomes blocked BY a creature") is deliberately not read here.
// The event names exactly one creature, so the scope test is identity with the
// source: this factory models the self-subject head only.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface AttackerBlockedTriggerArgs {
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

/** Builds a `TriggeredAbility` listening for `ATTACKER_BLOCKED`
 *  (CR 509.3c) on the source itself. */
export function attackerBlockedTrigger(
    args: AttackerBlockedTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "ATTACKER_BLOCKED",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "ATTACKER_BLOCKED") return false;
            if (event.attackerId !== self.id) return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        effects: args.effects,
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            event.type === "ATTACKER_BLOCKED" && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}
