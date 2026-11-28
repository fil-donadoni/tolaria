// `expendTrigger` — declarative factory for "whenever you expend N" triggered
// abilities (CR 700.14: "A player expends N if they pay a cost to cast a spell
// and the amount of mana that player spent this turn to cast spells prior to
// paying that cost was less than N and became at least N after paying that
// cost.").
//
// `MANA_EXPENDED` is emitted at the cast choke point with the caster's tally
// before and after the payment (`emitSpellCastEvent`, `gre/state.ts`), so this
// factory only gates the payer's relation to the trigger's controller (CR
// 109.5: "you" is the triggered ability's controller) and the threshold
// crossing. The tally only grows within a turn, so each N is crossed at most
// once per turn.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface ExpendTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3). */
    oracleText: string;
    /** The N of "expend N". */
    amount: number;
    /** Effect Script (ADR 0045), run with the source's controller and
     *  `$source` bound. */
    effects: EffectOp[];
    /** CR 603.3d — a target announced as the trigger goes on the stack. */
    targetRequirement?: TargetRequirement;
    /** CR 603.4 check-time predicate, after the crossing passes. */
    condition?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if, re-evaluated at resolution by the engine. */
    interveningIf?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
}

/** CR 700.14 — the payment took the tally from below `amount` to at least
 *  `amount`. */
export function expendCrosses(
    amount: number,
    priorTotal: number,
    total: number
): boolean {
    return priorTotal < amount && total >= amount;
}

/** Builds a `TriggeredAbility` listening for `MANA_EXPENDED` (CR 700.14). */
export function expendTrigger(args: ExpendTriggerArgs): TriggeredAbility {
    const matches = (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (event.type !== "MANA_EXPENDED") return false;
        if (event.playerId !== self.controllerId) return false;
        if (!expendCrosses(args.amount, event.priorTotal, event.total))
            return false;
        if (args.condition !== undefined && !args.condition(event, self, state))
            return false;
        return true;
    };
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "MANA_EXPENDED",
        matches,
        effects: args.effects,
        ...(args.targetRequirement !== undefined
            ? { targetRequirement: args.targetRequirement }
            : {}),
        ...(args.interveningIf !== undefined
            ? { interveningIf: args.interveningIf }
            : {}),
    };
    return withTriggerGate(ability, args);
}
