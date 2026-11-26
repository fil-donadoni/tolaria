// `lifeChangedTrigger` — declarative factory for triggers on a change of the
// controller's life total: "whenever you gain life" (CR 119.9) and "whenever
// you gain or lose life during your turn" (CR 119.3). The Effect Script twin of
// the closure-bodied `lifeLostTrigger`.
//
// The events come from the engine's life choke points: `LIFE_GAINED` from
// `gainLifeEmitting`, `LIFE_LOST` from `emitLifeLost` — both carry the amount
// ACTUALLY changed (post-replacement, post-prevention), and neither is emitted
// for a change of 0 (CR 119.9: "If a player gains 0 life, no life gain event
// has occurred"). One event per occurrence, so the ability triggers once per
// gain or loss.
//
// "you" is the ability's controller (CR 109.5). `duringYourTurn` narrows the
// trigger EVENT itself to the controller's own turn — it is part of the
// trigger condition, not a CR 603.4 intervening-if, so it is read in `matches`
// alone and never re-checked on resolution.

import type {
    EffectOp,
    GameEvent,
    GameEventType,
    PermanentView,
    TargetRequirement,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Which direction of the controller's life total fires the trigger. */
export type LifeChangeDirection = "gained" | "lost";

const DIRECTION_EVENT: Record<LifeChangeDirection, GameEventType> = {
    gained: "LIFE_GAINED",
    lost: "LIFE_LOST",
};

export interface LifeChangedTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3). */
    oracleText: string;
    /** The directions printed: `["gained"]` for "whenever you gain life",
     *  both for "whenever you gain or lose life". */
    directions: readonly LifeChangeDirection[];
    /** CR 603.2 — "during your turn": only a change while the ability's
     *  controller is the active player fires it. */
    duringYourTurn?: boolean;
    /** Effect Script (ADR 0045), run with the source's controller and
     *  `$source` bound. A single-direction trigger reads `$event.amount`. */
    effects: EffectOp[];
    /** CR 603.3d — a target announced as the trigger goes on the stack. */
    targetRequirement?: TargetRequirement;
    /** CR 603.4 check-time predicate, after the scope passes. */
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
    /** CR 603.2 — "This ability triggers only once each turn". */
    maxTriggersPerTurn?: number;
}

/** Builds a `TriggeredAbility` listening for the controller's life-total
 *  changes (CR 119.3 / 119.9). */
export function lifeChangedTrigger(
    args: LifeChangedTriggerArgs
): TriggeredAbility {
    if (args.directions.length === 0)
        throw new Error(
            `lifeChangedTrigger ${args.id}: names no direction of life change`
        );
    const events = args.directions.map((d) => DIRECTION_EVENT[d]);
    const matches = (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (event.type !== "LIFE_GAINED" && event.type !== "LIFE_LOST")
            return false;
        if (!events.includes(event.type)) return false;
        if (event.playerId !== self.controllerId) return false;
        // CR 603.2 — "during your turn" fails closed on an absent view: the
        // active player is not knowable without it.
        if (
            args.duringYourTurn === true &&
            state?.activePlayerId !== self.controllerId
        )
            return false;
        if (args.condition !== undefined && !args.condition(event, self, state))
            return false;
        return true;
    };
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        // CR 603.2 — one Oracle line over both events is ONE ability.
        event: events.length === 1 ? events[0] : events,
        matches,
        effects: args.effects,
        ...(args.targetRequirement !== undefined
            ? { targetRequirement: args.targetRequirement }
            : {}),
        ...(args.interveningIf !== undefined
            ? { interveningIf: args.interveningIf }
            : {}),
        ...(args.maxTriggersPerTurn !== undefined
            ? { maxTriggersPerTurn: args.maxTriggersPerTurn }
            : {}),
    };
    return withTriggerGate(ability, args);
}
