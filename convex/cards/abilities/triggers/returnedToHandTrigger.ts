// `returnedToHandTrigger` — specialized factory for `PERMANENT_RETURNED_TO_HAND`
// triggered abilities (ADR 0001, issue #1940 — "whenever a permanent is
// returned to a player's hand" / CR 603.2). Mirrors `diedTrigger`'s shape on
// purpose: same scope vocabulary (`PermanentScope`, shared with
// `enteredTrigger`/`leftTrigger`/`tappedTrigger`), same filter/condition/
// intervening-if wiring, same resolve/effects mutual exclusivity. The only
// differences are the event kind and the payload field naming exposed to
// `resolve`.
//
// Coexists intentionally with `leftTrigger({ toZone: "hand" })` — a bounced
// permanent fires BOTH `PERMANENT_LEFT` and `PERMANENT_RETURNED_TO_HAND`,
// exactly as a dying creature fires both `PERMANENT_LEFT` and `CREATURE_DIED`
// (`diedTrigger.ts`'s own header comment). Card authors pick the factory
// matching the oracle phrasing: `leftTrigger` for a generic "leaves the
// battlefield" line, this factory for "returned to a player's hand" wording.

import type { CardType } from "../../types";
import type {
    EffectOp,
    GameEvent,
    PermanentReturnedToHandEvent,
    PermanentView,
    SpellContext,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import type { PermanentFilter } from "../../filters";
import { matchesPermanentFilter, type MatchablePermanent } from "../../filters";
import {
    matchesPermanentScope,
    type PermanentScope,
    withTriggerGate,
} from "./shared";

/** Last-known-information payload (CR 603.10) handed to a
 *  `returnedToHandTrigger`'s `resolve` callback. The returned permanent is
 *  already sitting in its owner's hand by the time the trigger resolves;
 *  these fields snapshot what the engine knew about it at the moment of
 *  departure so resolvers never reach back into the hand for that data. */
export interface ReturnedPermanentInfo {
    id: string;
    /** Owner of the permanent — whose hand it returned to (CR 108.3 /
     *  400.7), the "that player" of "that player discards a card". */
    ownerId: string;
    /** Controller immediately before it left the battlefield (CR 603.10). */
    controllerId: string;
    types: ReadonlyArray<CardType>;
    subtypes: ReadonlyArray<string>;
}

export interface ReturnedToHandTriggerArgs {
    id: string;
    oracleText: string;
    /** Source-relative scope (CR 109.2). Warped Devotion's "a permanent" —
     *  ANY permanent, symmetric across either player — uses `"any"`. */
    scope: PermanentScope;
    /** Optional structural filter over the returned permanent. Matches the
     *  LKI fields carried on the event; subtype constraints work (the event
     *  snapshots them), static-ability constraints don't (not carried). */
    filter?: PermanentFilter;
    /** CR 603.4 check-time predicate. Evaluated once when the event fires;
     *  if false the trigger never goes on the stack. */
    condition?: (
        event: PermanentReturnedToHandEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if predicate. Evaluated at trigger-fire AND
     *  re-evaluated by the engine at resolve time; if false at resolve, the
     *  trigger fizzles (no `resolve` invocation, TRIGGER_FIZZLED emitted). */
    interveningIf?: (
        event: PermanentReturnedToHandEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect Script (ADR 0045) — the DSL-first default. Rides straight to
     *  the interpreter with the source's controller and `$source` bound; the
     *  returned permanent's owner/controller (the player who actually acts,
     *  for a board-wide "any" scope) is read via `{ ref: "$event.ownerId" }`
     *  (a censused `EVENT_FIELD_REGISTRY` row, ADR 0049) rather than the
     *  plain `"controller"` selector, which is only correct when the source's
     *  own controller happens to be the returning player. Mutually exclusive
     *  with `resolve`. */
    effects?: EffectOp[];
    /** Effect run when the trigger resolves from the stack. Receives the
     *  full event plus a flattened `ReturnedPermanentInfo` view so card
     *  bodies don't have to know the event's field naming. Mutually
     *  exclusive with `effects`. */
    resolve?: (
        ctx: SpellContext,
        event: PermanentReturnedToHandEvent,
        returned: ReturnedPermanentInfo
    ) => void;
}

/** Builds a `TriggeredAbility` listening for `PERMANENT_RETURNED_TO_HAND`
 *  events (ADR 0001, issue #1940). The factory handles event-type narrowing,
 *  scope gating, filter matching, and CR 603.4 / 603.4d wiring so card
 *  authors write only the effect body. */
export function returnedToHandTrigger(
    args: ReturnedToHandTriggerArgs
): TriggeredAbility {
    if (args.effects === undefined && args.resolve === undefined) {
        throw new Error(
            `returnedToHandTrigger("${args.id}"): declare either effects[] or resolve — neither was given`
        );
    }
    const userResolve = args.resolve;
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "PERMANENT_RETURNED_TO_HAND",
        matches: (event, self, state) => {
            if (event.type !== "PERMANENT_RETURNED_TO_HAND") return false;
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
                    subtypes: event.subtypes ? [...event.subtypes] : [],
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
        // ADR 0045 — an `effects[]` script is compiled downstream by the
        // interpreter; the factory only passes it through. Otherwise wrap the
        // imperative resolve with the LKI payload.
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "PERMANENT_RETURNED_TO_HAND") return;
                      const returned: ReturnedPermanentInfo = {
                          id: event.instanceId,
                          ownerId: event.ownerId,
                          controllerId: event.controllerId,
                          types: event.types,
                          subtypes: event.subtypes ?? [],
                      };
                      userResolve!(ctx, event, returned);
                  },
              }),
    };
    if (args.interveningIf !== undefined) {
        const userInterveningIf = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "PERMANENT_RETURNED_TO_HAND") return false;
            return userInterveningIf(event, self, state);
        };
    }
    return withTriggerGate(ability, args);
}
