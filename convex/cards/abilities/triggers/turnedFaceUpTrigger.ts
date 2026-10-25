// `turnedFaceUpTrigger` — factory for `PERMANENT_TURNED_FACE_UP` triggered
// abilities: "when this creature is turned face up". CR 708.8 — a face-down
// permanent turned face up regains its normal characteristics in place, and
// the engine queues ONE `PERMANENT_TURNED_FACE_UP` for it
// (`turnFaceUpOnBattlefield`, gre/faceDown.ts) once the turn-up is done, so
// the ability is on the permanent when triggers are collected. The event names
// exactly one permanent, so the scope test is identity with the source: this
// factory models the self-subject head only.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface TurnedFaceUpTriggerArgs {
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

/** Builds a `TriggeredAbility` listening for `PERMANENT_TURNED_FACE_UP`
 *  (CR 708.8) on the source itself. */
export function turnedFaceUpTrigger(
    args: TurnedFaceUpTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "PERMANENT_TURNED_FACE_UP",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "PERMANENT_TURNED_FACE_UP") return false;
            if (event.permanentId !== self.id) return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        effects: args.effects,
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            event.type === "PERMANENT_TURNED_FACE_UP" && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}
