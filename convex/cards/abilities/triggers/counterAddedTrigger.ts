// `counterAddedTrigger` — declarative factory for CR 122.1 "whenever one or
// more counters are put on ~" triggered abilities (issue #1319 foundation).
//
// Listens to `COUNTER_ADDED`, emitted once per placement occurrence by
// `SpellContext.addCounter` (state.ts) — the SAME choke point every counter-
// adding effect routes through, mirroring `COUNTER_REMOVED`'s established
// shape/drain path (Vanishing's sacrifice trigger, `fadingVanishing.ts`).
// General on purpose: not hardcoded to `+1/+1` — a card narrows `counterType`
// via `args.counterType` (Agatha's Cauldron-style "a +1/+1 counter"
// specificity) or omits it to fire on ANY counter kind.
//
// No card ships this factory yet (foundation-only, #917 → #12 Emperor of
// Bones / #14 Agatha's Cauldron are the future consumers). Scope + filter
// wiring mirrors `tappedTrigger.ts` exactly: `PermanentScope` gates by the
// counted permanent's identity relative to the source, an optional
// `PermanentFilter` narrows by type/subtype/controller-relation using the
// event's own emit-time snapshot (CR 603.10 last-known-info style) — no live
// battlefield re-scan needed.

import type { PermanentFilter } from "../../filters";
import { matchesPermanentFilter } from "../../filters";
import type {
    CardType,
    CounterAddedEvent,
    EffectOp,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import {
    matchesPermanentScope,
    type PermanentScope,
    withTriggerGate,
} from "./shared";

/** Flattened payload handed to a `counterAddedTrigger`'s resolve callback. */
export interface CounterAddedInfo {
    id: string;
    controllerId: string;
    types: ReadonlyArray<CardType>;
    subtypes: ReadonlyArray<string>;
    /** Kind of counter that was added (e.g. "+1/+1", "charge"). */
    counterType: string;
    /** How many counters of that kind were added THIS occurrence. */
    added: number;
    /** How many counters of that kind the permanent holds after the
     *  placement (>= `added`). */
    total: number;
}

export interface CounterAddedTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** Relation between the countered permanent and the source (CR 109.2). */
    scope: PermanentScope;
    /** Restrict to a single counter kind (case-sensitive, e.g. "+1/+1").
     *  Omit to fire on any counter type ("whenever one or more counters are
     *  put on ~" — the fully general CR 122.1 phrasing). */
    counterType?: string;
    /** Optional structural filter over the countered permanent (types,
     *  subtypes, controllerRelation, ...). Combined with `scope` via AND. */
    filter?: PermanentFilter;
    /** CR 603.4 check-time predicate, after scope+counterType+filter pass. */
    condition?: (
        event: CounterAddedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if; re-evaluated at resolve time by the engine. */
    interveningIf?: (
        event: CounterAddedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution effect. Receives the typed event plus a flattened payload
     *  so card bodies never re-narrow `event.type`. Mutually exclusive with
     *  `effects` — supply exactly one. */
    resolve?: (
        ctx: SpellContext,
        event: CounterAddedEvent,
        placed: CounterAddedInfo
    ) => void;
    /** DSL-first alternative to `resolve` (ADR 0045): the resolution effect as
     *  a declarative Effect Script, executed by the interpreter through the
     *  same path as every other trigger-site script. A chapter ability
     *  (CR 714.2, ADR 0078) always uses this leg — its effect never needs to
     *  inspect the firing event. Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
}

export function counterAddedTrigger(
    args: CounterAddedTriggerArgs
): TriggeredAbility {
    const counterAddedMatches = (
        event: CounterAddedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (
            args.counterType !== undefined &&
            event.counterType !== args.counterType
        ) {
            return false;
        }
        if (
            !matchesPermanentScope(
                args.scope,
                {
                    instanceId: event.instanceId,
                    controllerId: event.controllerId,
                },
                self
            )
        ) {
            return false;
        }
        if (args.filter) {
            const candidate = {
                id: event.instanceId,
                types: event.types,
                subtypes: event.subtypes,
                staticAbilities: [] as ReadonlyArray<string>,
                controllerId: event.controllerId,
            };
            const ok = matchesPermanentFilter(candidate, args.filter, {
                selfInstanceId: self.id,
                selfControllerId: self.controllerId,
            });
            if (!ok) return false;
        }
        if (args.condition && !args.condition(event, self, state)) return false;
        return true;
    };

    if ((args.resolve === undefined) === (args.effects === undefined)) {
        throw new Error(
            `counterAddedTrigger(${args.id}): supply exactly one of resolve / effects`
        );
    }

    const imperative = args.resolve;
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "COUNTER_ADDED",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "COUNTER_ADDED") return false;
            return counterAddedMatches(event, self, state);
        },
    };

    if (imperative) {
        ability.resolve = (ctx, event) => {
            if (event.type !== "COUNTER_ADDED") return;
            imperative(ctx, event, {
                id: event.instanceId,
                controllerId: event.controllerId,
                types: event.types,
                subtypes: event.subtypes,
                counterType: event.counterType,
                added: event.added,
                total: event.total,
            });
        };
    } else {
        ability.effects = args.effects;
    }

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "COUNTER_ADDED") return false;
            return cb(event, self, state);
        };
    }

    return withTriggerGate(ability, args);
}
