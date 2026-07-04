// `enteredTrigger` — specialized factory for `PERMANENT_ENTERED` triggered
// abilities (CR 603.6a — "when ~ enters the battlefield" triggers). Card
// authors declare scope, optional filter, optional condition and
// intervening-if predicates, and a resolve callback that receives a
// flattened payload identifying the permanent that entered. By far the most
// common scope is `self` (self-ETB triggers like Lich's drain or Elvish
// Visionary's draw).
//
// Mirrors `diedTrigger`'s shape on purpose: same scope vocabulary, same
// scope resolver (reused from `shared.ts`), same filter/condition/
// interveningIf wiring. The only differences are the event kind and the
// payload field naming exposed to `resolve`.

import type { CardType, EffectOp } from "../../types";
import type {
    GameEvent,
    PermanentEnteredEvent,
    PermanentView,
    SpellContext,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import type { PermanentFilter } from "../../filters";
import { matchesPermanentFilter, type MatchablePermanent } from "../../filters";
import { matchesPermanentScope, type PermanentScope } from "./shared";

/** Flattened payload (CR 603.6a) handed to an `enteredTrigger`'s resolve
 *  callback. The entering permanent is freshly on the battlefield by the time
 *  the trigger resolves; these fields snapshot the event's identifying
 *  information so resolvers don't have to narrow `event.type` themselves. */
export interface EnteredPermanentInfo {
    id: string;
    controllerId: string;
    types: ReadonlyArray<CardType>;
}

export interface EnteredTriggerArgs {
    id: string;
    oracleText: string;
    /** Source-relative scope (CR 109.2). For "another-yours" / "any-other"
     *  the entering permanent's instance id is compared to `self.id` so the
     *  source's own ETB doesn't fire the trigger. */
    scope: PermanentScope;
    /** Optional structural filter over the entering permanent (CR 603.6a —
     *  "whenever a creature with X enters"). Matches the event's `types` and
     *  controller-relation fields; subtype / static-ability constraints are
     *  not supported because the event payload doesn't carry that
     *  information at emit time. */
    filter?: PermanentFilter;
    /** CR 603.4 check-time predicate. Evaluated once when the event fires;
     *  if false the trigger never goes on the stack. Use for arbitrary
     *  domain logic that can't be expressed by `scope` + `filter`. */
    condition?: (
        event: PermanentEnteredEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if predicate. Evaluated at trigger-fire AND
     *  re-evaluated by the engine at resolve time; if false at resolve, the
     *  trigger fizzles (no `resolve` invocation, TRIGGER_FIZZLED event
     *  emitted). */
    interveningIf?: (
        event: PermanentEnteredEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect run when the trigger resolves from the stack. Receives the
     *  full event plus a flattened `EnteredPermanentInfo` view so card bodies
     *  don't have to know the event's field naming. Mutually exclusive with
     *  `effects` (the DSL-first alternative below) — use exactly one. */
    resolve?: (
        ctx: SpellContext,
        event: PermanentEnteredEvent,
        entered: EnteredPermanentInfo
    ) => void;
    /** Effect Script (ADR 0045, issues #803/#727) — declarative alternative
     *  to `resolve`. It rides straight to the interpreter with the trigger's
     *  controller and `$source` bound (the firing event is NOT threaded in —
     *  a self-ETB effect that must inspect the entering permanent's
     *  characteristics stays imperative via `resolve`). Unlike
     *  `phaseTrigger` / `drawTrigger`, an ETB trigger's ability always
     *  belongs to the SOURCE permanent (the thing that has the "when this
     *  enters" ability) — the entering permanent is a separate payload, never
     *  the acting player — so `ctx.controller` inside the script is always the
     *  source's controller regardless of `scope`. That means `effects` is safe
     *  for every scope value (no `scope: "your"`-only restriction like
     *  `phaseTrigger`/`drawTrigger`); Glacial Chasm — "when this enters,
     *  sacrifice a land" — is the canonical example. Mutually exclusive with
     *  `resolve`. */
    effects?: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `PERMANENT_ENTERED` events
 *  (CR 603.6a). The factory handles event-type narrowing, scope gating,
 *  filter matching, and CR 603.4 / 603.4d wiring so card authors write only
 *  the effect body. */
export function enteredTrigger(args: EnteredTriggerArgs): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "PERMANENT_ENTERED",
        matches: (event, self, state) => {
            if (event.type !== "PERMANENT_ENTERED") return false;
            const identity = {
                instanceId: event.instanceId,
                controllerId: event.controllerId,
            };
            if (!matchesPermanentScope(args.scope, identity, self))
                return false;
            if (args.filter !== undefined) {
                const subject: MatchablePermanent = {
                    id: event.instanceId,
                    types: event.types,
                    subtypes: [],
                    staticAbilities: [],
                    controllerId: event.controllerId,
                };
                if (
                    !matchesPermanentFilter(subject, args.filter, {
                        selfInstanceId: self.id,
                        selfControllerId: self.controllerId,
                    })
                ) {
                    return false;
                }
            }
            if (
                args.condition !== undefined &&
                !args.condition(event, self, state)
            ) {
                return false;
            }
            return true;
        },
        // ADR 0045 (issues #803/#727) — a declarative Effect Script bypasses
        // the event-narrowing `resolve` wrapper entirely: it rides straight to
        // the interpreter, which binds the controller and `$source` from the
        // resolution context. Because an ETB ability belongs to its source,
        // `ctx.controller` is the source's controller for every scope.
        // Mutually exclusive with `resolve`.
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "PERMANENT_ENTERED") return;
                      const entered: EnteredPermanentInfo = {
                          id: event.instanceId,
                          controllerId: event.controllerId,
                          types: event.types,
                      };
                      args.resolve!(ctx, event, entered);
                  },
              }),
    };
    if (args.interveningIf !== undefined) {
        const userInterveningIf = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "PERMANENT_ENTERED") return false;
            return userInterveningIf(event, self, state);
        };
    }
    return ability;
}
