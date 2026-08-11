// damageDealtTrigger — declarative factory for "whenever ~ deals damage"
// triggered abilities (CR 120.3 / 603.4). Card authors describe the source
// scope, optional source characteristics filter, and an optional target
// discriminator; the factory builds the underlying `TriggeredAbility` with
// `event.type` narrowing, scope resolution, and last-known-information
// payload delivery baked in.
//
// Pairs with `damageTakenTrigger.ts` — same engine event, mirrored gates.

import type {
    DamageDealtEvent,
    EffectOp,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import type {
    DamageSourceFilter,
    PermanentFilter,
    PlayerFilter,
} from "../../filters";
import {
    buildDamagePayload,
    isDamageDealtEvent,
    matchesSourceScope,
    passesSourceFilter,
    passesTargetPermanentFilter,
    passesTargetPlayerFilter,
    type DamageSourceScope,
    type DamageTriggerPayload,
    withTriggerGate,
} from "./shared";

/** Discriminator over the target of the damage event. CR 120.3 — damage is
 *  dealt to a creature, planeswalker, player, or battle. The factory honors
 *  the discriminator before applying the optional refinement (`filter` for
 *  permanents, `player` filter for players). */
export type DamageDealtTargetSpec =
    | { kind: "player"; player: PlayerFilter }
    | { kind: "permanent"; filter?: PermanentFilter }
    | { kind: "any" };

export interface DamageDealtTriggerArgs {
    id: string;
    oracleText: string;
    /** Controller-relation of the damage source to the trigger source's
     *  controller (CR 109.4). `self` — the trigger source IS the damage
     *  source; `yours` — same controller as trigger source; `opponents` —
     *  different controller; `any` — no constraint. */
    source: DamageSourceScope;
    /** Optional further constraints on the damage source's characteristics
     *  (CR 202.2 colors / 205 types / 702 keywords). Snapshotted from
     *  the event's source description fields. */
    sourceFilter?: DamageSourceFilter;
    /** Optional target discriminator. Omitted = match any target kind. */
    target?: DamageDealtTargetSpec;
    /** Only match combat damage (CR 510) when `true`, only non-combat when
     *  `false`. Omitted = no constraint. */
    isCombat?: boolean;
    /** Extra CR 603.4 check-time gate. Applied AFTER scope/filter checks. */
    condition?: (
        event: DamageDealtEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if — checked at trigger time AND re-checked at
     *  resolve time by the engine. False at either point fizzles the trigger. */
    interveningIf?: (
        event: DamageDealtEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect Script (ADR 0045) — the DSL-first default. Rides straight to
     *  the interpreter with the source's controller and `$source` bound; the
     *  damage event's last-known-info payload is a separate argument, not
     *  reachable from the script, so a `resolve` callback is still the escape
     *  hatch for an effect that needs it. Mutually exclusive with `resolve`. */
    effects?: EffectOp[];
    /** Effect to run when the trigger resolves. Receives a pre-narrowed
     *  payload — no need to re-check `event.type`. Mutually exclusive with
     *  `effects`. */
    resolve?: (
        ctx: SpellContext,
        event: DamageDealtEvent,
        damage: DamageTriggerPayload
    ) => void;
}

export function damageDealtTrigger(
    args: DamageDealtTriggerArgs
): TriggeredAbility {
    const {
        id,
        oracleText,
        source,
        sourceFilter,
        target,
        isCombat,
        condition,
        interveningIf,
        effects,
        resolve,
    } = args;

    if (effects === undefined && resolve === undefined) {
        throw new Error(
            `damageDealtTrigger("${id}"): declare either effects[] or resolve — neither was given`
        );
    }

    function targetPasses(
        event: DamageDealtEvent,
        self: PermanentView,
        state: TriggerStateView | undefined
    ): boolean {
        if (target === undefined || target.kind === "any") return true;
        if (target.kind === "player") {
            return passesTargetPlayerFilter(event, self, state, target.player);
        }
        // target.kind === "permanent"
        return passesTargetPermanentFilter(event, self, state, target.filter);
    }

    function matches(
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean {
        if (!isDamageDealtEvent(event)) return false;
        if (isCombat !== undefined && event.isCombat !== isCombat) return false;
        if (!matchesSourceScope(event, self, source)) return false;
        if (!passesSourceFilter(event, self, sourceFilter)) return false;
        if (!targetPasses(event, self, state)) return false;
        if (condition && !condition(event, self, state)) return false;
        if (interveningIf && !interveningIf(event, self, state)) return false;
        return true;
    }

    const ability: TriggeredAbility = {
        id,
        oracleText,
        event: "DAMAGE_DEALT",
        matches,
        ...(effects
            ? { effects }
            : {
                  resolve: (ctx: SpellContext, event: GameEvent) => {
                      if (!isDamageDealtEvent(event)) return;
                      resolve!(ctx, event, buildDamagePayload(event));
                  },
              }),
    };
    if (interveningIf) {
        ability.interveningIf = (
            event: GameEvent,
            self: PermanentView,
            state?: TriggerStateView
        ) => isDamageDealtEvent(event) && interveningIf(event, self, state);
    }
    return withTriggerGate(ability, args);
}
