// tappedTrigger — CR 701.20a (becomes tapped) + CR 605 (mana ability tap).
//
// Produces a TriggeredAbility listening to PERMANENT_TAPPED. Card authors
// declare scope (relation between the tapped permanent and the source),
// optional permanent filter (types/subtypes/keywords), and optional
// `forMana` discriminator that gates on whether the tap paid a mana
// ability's cost (CR 605). Emitted by every tap site so non-mana taps
// (Twiddle, combat declaration) feed Lifetap-style triggers and mana taps
// feed Mana Flare / Manabarbs / Wild Growth.
//
// `condition` runs at trigger-check time only (CR 603.4). `interveningIf`
// runs both at check time and is re-evaluated at resolve time by the
// engine (CR 603.4d) — if false at resolve, the trigger fizzles.

import type {
    GameEvent,
    PermanentTappedEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
    TapManaBonusForPotential,
    ManaCost,
    CardType,
} from "../../types";
import { matchesPermanentFilter, type PermanentFilter } from "../../filters";
import { matchesPermanentScope, type PermanentScope } from "./shared";

export interface TappedTriggerArgs {
    /** Stable id on the source CardDefinition's triggeredAbilities[]. */
    id: string;
    /** Oracle text shown on the stack and in context menus. */
    oracleText: string;
    /** Relation between the tapped permanent and the source (CR 109.2). */
    scope: PermanentScope;
    /** Optional declarative filter over the tapped permanent (types,
     *  subtypes, controllerRelation, ...). Combined with `scope` via AND. */
    filter?: PermanentFilter;
    /** CR 605.1 — gate on "tapped for mana". `true` only mana-ability taps,
     *  `false` only non-mana taps, undefined matches either. */
    forMana?: boolean;
    /** CR 605.1b / 605.4 — this tap trigger is itself a MANA ABILITY (it could
     *  add mana when it resolves and has no target: Wild Growth, Mana Flare,
     *  Gauntlet of Might, Snowfall). The engine resolves it immediately without
     *  using the stack, so the extra mana is in the pool within the same cost
     *  payment that tapped the land. Leave `false`/undefined for a `forMana` tap
     *  trigger that adds NO mana (Manabarbs' damage) — that one uses the stack. */
    manaAbility?: boolean;
    /** CR 605.4 — declarative descriptor of the guaranteed extra mana this
     *  mana-ability tap trigger adds, for the PREDICTIVE potential-mana models
     *  (castability gate + auto-tap solver). See
     *  `TriggeredAbility.manaBonusForPotential`. Omit for a restricted-mana
     *  bonus (Snowfall) — it must stay invisible to spell affordability. */
    manaBonusForPotential?: TapManaBonusForPotential;
    /** CR 603.4 check-time predicate. Runs after scope+filter+forMana pass. */
    condition?: (
        event: PermanentTappedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if. Engine re-evaluates at resolve time; false
     *  resolves to a fizzle (no `resolve` invocation, TRIGGER_FIZZLED event). */
    interveningIf?: (
        event: PermanentTappedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution effect. Receives a pre-narrowed event + a derived payload
     *  exposing the tapped permanent's last-known fields plus `manaProduced`
     *  (CR 605.4) when `forMana` was true. Card authors never narrow
     *  `event.type` inside the body. */
    resolve: (
        ctx: SpellContext,
        event: PermanentTappedEvent,
        tapped: {
            id: string;
            controllerId: string;
            types: ReadonlyArray<CardType>;
            subtypes: ReadonlyArray<string>;
            forMana: boolean;
            manaProduced?: ManaCost;
        }
    ) => void;
}

export function tappedTrigger(args: TappedTriggerArgs): TriggeredAbility {
    const tappedMatches = (
        event: PermanentTappedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (args.forMana !== undefined && event.forMana !== args.forMana) {
            return false;
        }
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
        event: "PERMANENT_TAPPED",
        // CR 605.1b / 605.4 — a mana-adding tap trigger resolves immediately
        // without using the stack; the engine reads this flag in
        // `processPendingActionTriggers`.
        ...(args.manaAbility ? { manaAbility: true } : {}),
        // CR 605.4 — declarative extra-mana descriptor for the predictive
        // potential-mana models (castability gate + auto-tap solver).
        ...(args.manaBonusForPotential
            ? { manaBonusForPotential: args.manaBonusForPotential }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "PERMANENT_TAPPED") return false;
            return tappedMatches(event, self, state);
        },
        resolve: (ctx, event) => {
            if (event.type !== "PERMANENT_TAPPED") return;
            args.resolve(ctx, event, {
                id: event.permanentId,
                controllerId: event.controllerId,
                types: event.permanentTypes,
                subtypes: event.permanentSubtypes,
                forMana: event.forMana,
                manaProduced: event.manaProduced,
            });
        },
    };

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "PERMANENT_TAPPED") return false;
            return cb(event, self, state);
        };
    }

    return ability;
}
