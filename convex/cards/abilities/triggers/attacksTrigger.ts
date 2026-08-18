// `attacksTrigger` — specialized factory for `ATTACKERS_DECLARED` triggered
// abilities ("whenever this creature attacks", "whenever a creature you
// control attacks"). CR 508.1m — "Any abilities that trigger on attackers
// being declared trigger" — fires off the ONE batch event the declare-
// attackers step emits.
//
// The event is deliberately batch-shaped: `emitAttackersDeclaredEvents`
// (`gre/phases.ts`) emits a SINGLE `ATTACKERS_DECLARED` carrying every
// declared attacker in `attackerIds`, so a "whenever one or more creatures you
// control attack" ability fires exactly once. That is why this factory cannot
// reuse `matchesPermanentScope` directly the way `tappedTrigger` /
// `enteredTrigger` do — there is no single "affected permanent" on the event.
// It scopes per ATTACKER instead: the ability fires when AT LEAST ONE declared
// attacker satisfies `scope` relative to the source.
//
// Every attacker in one declaration is controlled by the active player
// (CR 508.1a — "The active player chooses which creatures THAT THEY CONTROL,
// if any, will attack"), so `event.attackingPlayerId` is the exact controller
// of every id in `attackerIds` and the scope check needs no per-attacker
// controller lookup.
//
// Before this factory existed, every attack trigger in the catalogue wrote its
// own inline `matches` over `event.attackerIds` (Rogue Kavu, `sets/inv/red.ts`).
// Those stay as they are — they gate on shapes this factory deliberately does
// not model ("attacks ALONE" is a cardinality test on the whole batch, not a
// scope test on one attacker). What this factory is FOR is the self-scoped
// "whenever this creature attacks" shape, which is also the only shape the
// JSON-pure token surface (`EffectTokenSpec.triggeredAbilities` →
// `resolveTokenTriggeredAbilities`, issue #2364) can express at all.

import type {
    EffectOp,
    AttackersDeclaredEvent,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import {
    matchesPermanentScope,
    type PermanentScope,
    withTriggerGate,
} from "./shared";

/** Flattened payload handed to an `attacksTrigger`'s resolve callback — the
 *  declaration as the engine emitted it, so a body never re-narrows
 *  `event.type` itself. Deliberately NOT pre-filtered to the scope-matching
 *  subset: the scope test needs the source's `PermanentView`, which a
 *  `SpellContext` resolution site does not carry, and a half-accurate subset
 *  would be worse than the full list a body can filter itself. */
export interface AttackDeclarationInfo {
    /** The active player, i.e. the controller of every id below
     *  (CR 508.1a). */
    attackingPlayerId: string;
    /** Every creature declared as an attacker this combat. */
    attackerIds: ReadonlyArray<string>;
}

export interface AttacksTriggerArgs {
    /** Stable id on the source `CardDefinition`'s `triggeredAbilities[]`. */
    id: string;
    /** Oracle text shown on the stack / in the inspector. */
    oracleText: string;
    /** Source-relative scope (CR 109.2), tested per declared attacker. `self`
     *  is "whenever this creature attacks"; `yours` is "whenever a creature
     *  you control attacks"; `another-yours` / `any-other` exclude the source
     *  itself. The ability fires once if ANY attacker matches — never once per
     *  matching attacker, because the engine emits one event per declaration
     *  (CR 508.1m). */
    scope: PermanentScope;
    /** CR 603.4 check-time predicate, evaluated once when the event fires
     *  after `scope` passes. Use for shapes `scope` cannot express (a
     *  cardinality test over the whole batch). */
    condition?: (
        event: AttackersDeclaredEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if predicate. Re-evaluated by the engine at
     *  resolve time; false at resolve fizzles the trigger. */
    interveningIf?: (
        event: AttackersDeclaredEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect Script (ADR 0045) — the DSL-first default. Rides straight to the
     *  interpreter with the source's controller and `$source` bound. The
     *  declaration payload is NOT reachable from the script, so an effect that
     *  must inspect WHICH creatures attacked still needs a `resolve` callback.
     *  Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
    /** Imperative resolution body, receiving the narrowed event plus the
     *  flattened declaration payload. Mutually exclusive with `effects`. */
    resolve?: (
        ctx: SpellContext,
        event: AttackersDeclaredEvent,
        declaration: AttackDeclarationInfo
    ) => void;
    /** AI-only SHADOW Effect Script for a `resolve()` body (PRD #1423) —
     *  never executed, only walked by `OP_VALUERS`. Meaningless alongside
     *  `effects`. */
    aiEffects?: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `ATTACKERS_DECLARED`
 *  (CR 508.1m). The factory handles event narrowing, per-attacker scope
 *  gating and CR 603.4 wiring so card authors write only the body. */
export function attacksTrigger(args: AttacksTriggerArgs): TriggeredAbility {
    if (args.effects === undefined && args.resolve === undefined) {
        throw new Error(
            `attacksTrigger("${args.id}"): declare either effects[] or resolve — neither was given`
        );
    }
    const userResolve = args.resolve;
    const matched = (
        event: AttackersDeclaredEvent,
        self: PermanentView
    ): string[] =>
        event.attackerIds.filter((attackerId) =>
            matchesPermanentScope(
                args.scope,
                {
                    instanceId: attackerId,
                    // CR 508.1a — every declared attacker is controlled by the
                    // active player, so the batch's `attackingPlayerId` IS the
                    // per-attacker controller.
                    controllerId: event.attackingPlayerId,
                },
                self
            )
        );

    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "ATTACKERS_DECLARED",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "ATTACKERS_DECLARED") return false;
            if (matched(event, self).length === 0) return false;
            if (args.condition && !args.condition(event, self, state)) {
                return false;
            }
            return true;
        },
        // ADR 0045 — an `effects[]` script is compiled downstream by
        // `getAbilityEffectFn` (effectRegistry.ts); the factory only passes it
        // through. Otherwise wrap the imperative resolve with the payload.
        ...(args.effects
            ? { effects: args.effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (event.type !== "ATTACKERS_DECLARED") return;
                      userResolve!(ctx, event, {
                          attackingPlayerId: event.attackingPlayerId,
                          attackerIds: event.attackerIds,
                      });
                  },
              }),
        ...(args.aiEffects ? { aiEffects: args.aiEffects } : {}),
    };

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "ATTACKERS_DECLARED") return false;
            return cb(event, self, state);
        };
    }

    return withTriggerGate(ability, args);
}
