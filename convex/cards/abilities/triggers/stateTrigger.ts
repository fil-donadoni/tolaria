// State trigger factory (CR 603.8).
//
// State-triggered abilities are not event-driven: they probe persistent game
// conditions ("when ~ controls no Islands", "when an opponent has 13 life")
// and fire as soon as the condition is met. The GRE models this via the
// synthetic `STATE_CHECK` event emitted at every stable checkpoint where a
// player would gain priority (see `convex/gre/triggers.ts:collectStateTriggers`).
//
// The factory bakes two CR 603.8 invariants so card authors never reimplement
// them:
//
//  1. The `matches` callback narrows to `STATE_CHECK` and delegates to the
//     author's `condition(self, state)` — no event-type checks at the call
//     site, no scope/filter (the condition does all the work).
//  2. `interveningIf` is set to the same predicate so the trigger fizzles
//     automatically at resolution if the persistent condition is no longer
//     met (CR 603.8 — "the ability triggers again the next time the
//     condition is true"; if it's false at resolve, the queued copy must
//     not apply).
//
// The anti-loop guard ("does not trigger again while a copy is on the stack")
// lives in the engine's `stateTriggerAlreadyOnStack` (CR 603.8 last sentence)
// and is shared across every `stateTrigger` instance.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";

export interface StateTriggerArgs {
    /** Unique-per-card ability id. Surfaces on the stack item and in tests. */
    id: string;
    /** Oracle text rendered on the stack and in context menus. */
    oracleText: string;
    /** Persistent-state predicate. Evaluated at every `STATE_CHECK` probe
     *  AND re-evaluated at resolve time (CR 603.8). Receives the source
     *  permanent view and a read-only window over the live game state. */
    condition: (self: PermanentView, state: TriggerStateView) => boolean;
    /** Effect run when the trigger resolves from the stack. Mutually
     *  exclusive with `effects`. */
    resolve?: (ctx: SpellContext) => void;
    /** Effect Script (ADR 0045) — the trigger's effect as declarative,
     *  JSON-pure data instead of an imperative `resolve`. The interpreter
     *  runs it through the shared spell/ability code path with the
     *  trigger's controller and source permanent bound (`$source`,
     *  `ctx.controller`). Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
}

/** Builds a CR 603.8 state-triggered ability. The factory wires up the
 *  `STATE_CHECK` event narrowing and the resolve-time re-check; card authors
 *  declare only the predicate and the effect (imperative `resolve` or a
 *  declarative `effects[]` script — mutually exclusive). */
export function stateTrigger(args: StateTriggerArgs): TriggeredAbility {
    const { id, oracleText, condition, resolve, effects } = args;
    return {
        id,
        oracleText,
        event: "STATE_CHECK",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "STATE_CHECK") return false;
            if (!state) return false;
            return condition(self, state);
        },
        // CR 603.8 — the predicate is re-checked at resolution. If the
        // persistent state has changed since the trigger went on the stack,
        // the engine fizzles the trigger without invoking `resolve`/`effects`
        // and emits a `TRIGGER_FIZZLED` event for downstream observers.
        interveningIf: (_event, self, state) => {
            if (!state) return false;
            return condition(self, state);
        },
        ...(effects
            ? { effects }
            : {
                  resolve: (ctx: SpellContext) => {
                      resolve?.(ctx);
                  },
              }),
    };
}
