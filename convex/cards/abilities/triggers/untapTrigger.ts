// untapTrigger — CR 701.20b (becomes untapped).
//
// Produces a TriggeredAbility listening to PERMANENT_UNTAPPED, the complement
// of `tappedTrigger`. The event is emitted by every untap site that flips a
// permanent from tapped to untapped: the untap step (CR 502.2) and untap
// effects (Twiddle). Card authors declare scope (relation between the untapped
// permanent and the source) plus an optional filter and condition.
//
// Introduced for the exile-and-return mechanism (Tawnos's Coffin, ADR 0028):
// "When this artifact ... becomes untapped, return that exiled card ...". The
// armed bundle is the delayed-trigger flag, so the card gates `condition` on
// `state.exileHeld` to avoid pushing a do-nothing trigger when the source is
// holding nothing.
//
// `condition` runs at trigger-check time only (CR 603.4). `interveningIf` runs
// both at check time and is re-evaluated at resolve time by the engine
// (CR 603.4d) — if false at resolve, the trigger fizzles.

import type { PermanentFilter } from "../../filters";
import { matchesPermanentFilter } from "../../filters";
import type {
    GameEvent,
    PermanentUntappedEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
    CardType,
} from "../../types";
import { matchesPermanentScope, type PermanentScope } from "./shared";

export interface UntappedTriggerArgs {
    /** Stable id on the source CardDefinition's triggeredAbilities[]. */
    id: string;
    /** Oracle text shown on the stack and in context menus. */
    oracleText: string;
    /** Relation between the untapped permanent and the source (CR 109.2). */
    scope: PermanentScope;
    /** Optional declarative filter over the untapped permanent (types,
     *  subtypes, controllerRelation, ...). Combined with `scope` via AND. */
    filter?: PermanentFilter;
    /** CR 603.4 check-time predicate. Runs after scope + filter pass. */
    condition?: (
        event: PermanentUntappedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if. Engine re-evaluates at resolve time; false
     *  resolves to a fizzle (no `resolve` invocation, TRIGGER_FIZZLED event). */
    interveningIf?: (
        event: PermanentUntappedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution effect. Receives a pre-narrowed event + a derived payload
     *  exposing the untapped permanent's last-known fields. Card authors never
     *  narrow `event.type` inside the body. */
    resolve: (
        ctx: SpellContext,
        event: PermanentUntappedEvent,
        untapped: {
            id: string;
            controllerId: string;
            types: ReadonlyArray<CardType>;
            subtypes: ReadonlyArray<string>;
        }
    ) => void;
}

export function untapTrigger(args: UntappedTriggerArgs): TriggeredAbility {
    const untappedMatches = (
        event: PermanentUntappedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (
            !matchesPermanentScope(
                args.scope,
                {
                    instanceId: event.permanentId,
                    controllerId: event.controllerId,
                },
                self
            )
        ) {
            return false;
        }
        if (args.filter) {
            const candidate = {
                id: event.permanentId,
                types: event.permanentTypes,
                subtypes: event.permanentSubtypes,
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

    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "PERMANENT_UNTAPPED",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "PERMANENT_UNTAPPED") return false;
            return untappedMatches(event, self, state);
        },
        resolve: (ctx, event) => {
            if (event.type !== "PERMANENT_UNTAPPED") return;
            args.resolve(ctx, event, {
                id: event.permanentId,
                controllerId: event.controllerId,
                types: event.permanentTypes,
                subtypes: event.permanentSubtypes,
            });
        },
    };

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "PERMANENT_UNTAPPED") return false;
            return cb(event, self, state);
        };
    }

    return ability;
}
