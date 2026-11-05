// `transformsTrigger` — factory for `PERMANENT_TRANSFORMED` triggered abilities:
// "when this creature transforms into {self}". CR 701.27e — the ability triggers
// if the object transforms and has the named characteristic immediately after.
// The engine queues ONE `PERMANENT_TRANSFORMED` once the flip is done
// (`SpellContext.transform`, gre/state.ts), so triggers are collected from the
// face now up: an ability printed on that face is the only one that can read
// the event, which is what "into {self}" asks. The event names exactly one
// permanent, so the scope test is identity with the source. CR 701.28's convert
// is not modelled (registry row `convert`), so a transform is the only firing.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface TransformsTriggerArgs {
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

/** Builds a `TriggeredAbility` listening for `PERMANENT_TRANSFORMED`
 *  (CR 701.27e) on the source itself. */
export function transformsTrigger(
    args: TransformsTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "PERMANENT_TRANSFORMED",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "PERMANENT_TRANSFORMED") return false;
            if (event.permanentId !== self.id) return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        effects: args.effects,
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            event.type === "PERMANENT_TRANSFORMED" && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}
