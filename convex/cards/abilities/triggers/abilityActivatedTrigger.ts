// abilityActivatedTrigger — CR 602.1 (activated abilities) + CR 603.2.
//
// Produces a TriggeredAbility listening to ABILITY_ACTIVATED, the non-{T}
// complement of PERMANENT_TAPPED (see `AbilityActivatedEvent` in types.ts).
// The engine emits ABILITY_ACTIVATED only for non-mana activated abilities
// WITHOUT a {T} component, so a card that wants to react to "tapped OR a
// non-tap ability activated" (Antiquities cluster B — Haunting Wind,
// Powerleech, Artifact Possession) pairs THIS factory with `tappedTrigger`:
// the tap half is covered by PERMANENT_TAPPED, the non-tap half by this event.
//
// Card authors declare `scope` (relation between the activating permanent and
// the source), an optional permanent `filter`, and a resolve body that
// receives a pre-narrowed event plus a small last-known-information payload
// (CR 603.10) — they never narrow `event.type` inside the body.
//
// `condition` runs at trigger-check time only (CR 603.4). `interveningIf`
// runs at check time and is re-evaluated at resolve time by the engine
// (CR 603.4d) — false at resolve fizzles the trigger.

import type {
    AbilityActivatedEvent,
    CardType,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { matchesPermanentFilter, type PermanentFilter } from "../../filters";
import { matchesPermanentScope, type PermanentScope } from "./shared";

export interface AbilityActivatedTriggerArgs {
    /** Stable id on the source CardDefinition's triggeredAbilities[]. */
    id: string;
    /** Oracle text shown on the stack and in context menus. */
    oracleText: string;
    /** Relation between the activating permanent and the source (CR 109.2). */
    scope: PermanentScope;
    /** Optional declarative filter over the activating permanent (types,
     *  subtypes, controllerRelation, ...). Combined with `scope` via AND. */
    filter?: PermanentFilter;
    /** CR 603.4 check-time predicate. Runs after scope+filter pass. */
    condition?: (
        event: AbilityActivatedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if. Engine re-evaluates at resolve time; false
     *  resolves to a fizzle (no `resolve` invocation, TRIGGER_FIZZLED event). */
    interveningIf?: (
        event: AbilityActivatedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution effect. Receives a pre-narrowed event + a derived payload
     *  exposing the activating permanent's last-known fields (CR 603.10). */
    resolve: (
        ctx: SpellContext,
        event: AbilityActivatedEvent,
        activated: {
            id: string;
            controllerId: string;
            types: ReadonlyArray<CardType>;
            subtypes: ReadonlyArray<string>;
        }
    ) => void;
}

export function abilityActivatedTrigger(
    args: AbilityActivatedTriggerArgs
): TriggeredAbility {
    const activatedMatches = (
        event: AbilityActivatedEvent,
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
        event: "ABILITY_ACTIVATED",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "ABILITY_ACTIVATED") return false;
            return activatedMatches(event, self, state);
        },
        resolve: (ctx, event) => {
            if (event.type !== "ABILITY_ACTIVATED") return;
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
            if (event.type !== "ABILITY_ACTIVATED") return false;
            return cb(event, self, state);
        };
    }

    return ability;
}
