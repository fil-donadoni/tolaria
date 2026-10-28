// `becameTargetTrigger` — factory for `BECAME_TARGET` triggered abilities:
// "whenever this creature becomes the target of a spell or ability". CR 603.2
// + CR 115.1 — the engine emits one `BECAME_TARGET` per target as a spell's or
// ability's targets are locked (cast, activation, trigger announcement), so
// the event names exactly one object and the scope test is identity with the
// source. Not narrowed to an opponent's spell or ability: that narrowing is
// Ward's own (CR 702.21a), and this wording says plainly "a spell or ability".
// This factory models the self-subject head only.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface BecameTargetTriggerArgs {
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
    /** CR 603.2 — "This ability triggers only N times each turn", counted per
     *  source object (`TriggeredAbility.maxTriggersPerTurn`). */
    maxTriggersPerTurn?: number;
    /** Effect Script (ADR 0045). */
    effects: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `BECAME_TARGET` (CR 603.2) on
 *  the source itself. */
export function becameTargetTrigger(
    args: BecameTargetTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "BECAME_TARGET",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "BECAME_TARGET") return false;
            if (event.target.type !== "permanent") return false;
            if (event.target.id !== self.id) return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        ...(args.maxTriggersPerTurn !== undefined
            ? { maxTriggersPerTurn: args.maxTriggersPerTurn }
            : {}),
        effects: args.effects,
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            event.type === "BECAME_TARGET" && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}
