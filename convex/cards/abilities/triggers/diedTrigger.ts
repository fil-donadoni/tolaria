// `diedTrigger` — specialized factory for `CREATURE_DIED` triggered abilities
// (CR 700.4 — a creature dies when it's put into a graveyard from the
// battlefield; CR 603.2 death trigger). Card authors declare scope, optional
// filter, optional condition and intervening-if predicates, and a resolve
// callback that receives a last-known-information payload (CR 603.10) so the
// dying creature's controller, types, and P/T are explicit instead of being
// re-fished out of `event.creature*` inside every card.

import type { CardType } from "../../types";
import type {
    CreatureDiedEvent,
    EffectOp,
    GameEvent,
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

/** Last-known-information payload (CR 603.10) handed to a `diedTrigger`'s
 *  resolve callback. The dying creature has already left the battlefield by
 *  the time the trigger resolves; these fields snapshot what the engine knew
 *  about it at the moment of death so resolvers never reach back into the
 *  graveyard for moment-of-death data. */
export interface DeadCreatureLKI {
    id: string;
    controllerId: string;
    types: ReadonlyArray<CardType>;
    lastKnownPower: number;
    lastKnownToughness: number;
    damagedBySources: ReadonlyArray<string>;
    /** Creatures blocking or blocked by the dead creature at the moment of
     *  death (CR 603.10). Empty when it was not in combat. Read by Abu Ja'far. */
    combatPartnerIds: ReadonlyArray<string>;
}

export interface DiedTriggerArgs {
    id: string;
    oracleText: string;
    /** Source-relative scope (CR 109.2). For "another-yours" / "any-other"
     *  the dying creature's instance id is compared to `self.id` so the
     *  source's own death doesn't fire the trigger. */
    scope: PermanentScope;
    /** Optional structural filter over the dying creature (CR 603.2 — "a
     *  creature with X"). Matches the LKI fields carried on the event;
     *  subtype / static-ability constraints are not supported because the
     *  event payload doesn't carry that information. */
    filter?: PermanentFilter;
    /** CR 603.4 check-time predicate. Evaluated once when the event fires;
     *  if false the trigger never goes on the stack. Use for arbitrary
     *  domain logic that can't be expressed by `scope` + `filter` (e.g.
     *  Sengir Vampire's `damagedBySources` check). */
    condition?: (
        event: CreatureDiedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if predicate. Evaluated at trigger-fire AND
     *  re-evaluated by the engine at resolve time; if false at resolve, the
     *  trigger fizzles (no `resolve` invocation, TRIGGER_FIZZLED event
     *  emitted). */
    interveningIf?: (
        event: CreatureDiedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect Script (ADR 0045) — the DSL-first default. Rides straight to the
     *  interpreter with the source's controller and `$source` bound; the dead
     *  creature's last-known-info (`DeadCreatureLKI`) is a separate payload,
     *  NOT reachable from the script, so an effect that must inspect the dying
     *  creature (its controller, P/T, `damagedBySources`, combat partners)
     *  still needs a `resolve` callback. Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
    /** Effect run when the trigger resolves from the stack. Receives the
     *  full event, plus a flattened `DeadCreatureLKI` view so card bodies
     *  don't have to know the event's field naming. Mutually exclusive with
     *  `effects`. */
    resolve?: (
        ctx: SpellContext,
        event: CreatureDiedEvent,
        deadCreature: DeadCreatureLKI
    ) => void;
    /** AI-only SHADOW Effect Script for a `resolve()` body (PRD #1423, issue
     *  #1431/#2364) — never executed, only walked by `OP_VALUERS` so the
     *  bot's value model has something to score for an imperative dies
     *  trigger. Passed straight through to the built `TriggeredAbility`; see
     *  `CardDefinition.aiEffects` for the full contract. Meaningless
     *  alongside `effects` (a real script is already valued) — mirrors
     *  `enteredTrigger`'s own `aiEffects` passthrough, added here to close
     *  the same gap for death triggers (Vaultborn Tyrant's token-copy
     *  `resolve()`, issue #2364). */
    aiEffects?: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `CREATURE_DIED` events
 *  (CR 700.4 / 603.2). The factory handles event-type narrowing, scope
 *  gating, filter matching, and CR 603.4 / 603.4d wiring so card authors
 *  write only the effect body. */
export function diedTrigger(args: DiedTriggerArgs): TriggeredAbility {
    if (args.effects === undefined && args.resolve === undefined) {
        throw new Error(
            `diedTrigger("${args.id}"): declare either effects[] or resolve — neither was given`
        );
    }
    const userResolve = args.resolve;
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "CREATURE_DIED",
        matches: (event, self, state) => {
            if (event.type !== "CREATURE_DIED") return false;
            const identity = {
                instanceId: event.creatureInstanceId,
                controllerId: event.creatureControllerId,
            };
            if (!matchesPermanentScope(args.scope, identity, self))
                return false;
            if (args.filter !== undefined) {
                const subject: MatchablePermanent = {
                    id: event.creatureInstanceId,
                    types: event.creatureTypes,
                    subtypes: [],
                    staticAbilities: [],
                    controllerId: event.creatureControllerId,
                    power: event.creaturePower,
                    toughness: event.creatureToughness,
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
        // ADR 0045 — an `effects[]` script is compiled downstream by
        // `getAbilityEffectFn` (effectRegistry.ts); the factory only passes it
        // through. Otherwise wrap the imperative resolve with the LKI payload.
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "CREATURE_DIED") return;
                      const deadCreature: DeadCreatureLKI = {
                          id: event.creatureInstanceId,
                          controllerId: event.creatureControllerId,
                          types: event.creatureTypes,
                          lastKnownPower: event.creaturePower,
                          lastKnownToughness: event.creatureToughness,
                          damagedBySources: event.damagedBySources,
                          combatPartnerIds: event.combatPartnerIds ?? [],
                      };
                      userResolve!(ctx, event, deadCreature);
                  },
              }),
    };
    if (args.interveningIf !== undefined) {
        const userInterveningIf = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "CREATURE_DIED") return false;
            return userInterveningIf(event, self, state);
        };
    }
    if (args.aiEffects !== undefined) {
        ability.aiEffects = args.aiEffects;
    }
    return withTriggerGate(ability, args);
}
