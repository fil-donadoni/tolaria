// damageTakenTrigger — declarative factory for "whenever ~ is dealt damage"
// triggered abilities (CR 120.3 / 603.4). Mirror of `damageDealtTrigger`:
// listens to the same engine event but gates on the target side. The optional
// `sourceFilter` and `source` scope refine the dealer side.

import type {
    DamageDealtEvent,
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

/** Discriminator over the side that took the damage. Required — the whole
 *  point of `damageTakenTrigger` is to gate on the receiver. Use a
 *  `PermanentFilter` with `controllerRelation: "self"` for the canonical
 *  "whenever this creature is dealt damage" case (CR 109.2).
 *
 *  ASYMMETRY WITH THE MIRROR (issue #1855). `DamageDealtTargetSpec` grew a
 *  `"player-or-planeswalker"` member; this union deliberately did NOT. The
 *  dealt-side member exists because that clause spans the player/permanent
 *  axis and is therefore inexpressible with the other members. On the taken
 *  side the single-recipient shapes are already covered — "whenever a
 *  planeswalker you control is dealt damage" IS
 *  `{ kind: "permanent", filter: { types: "Planeswalker", controllerRelation:
 *  "yours" } }`. Only the disjunction ("dealt damage to you or a planeswalker
 *  you control") would need a new member, and no shipped card uses it. An
 *  inert union member is not free: it ships untested, un-exercised surface
 *  that reads as supported. Add it with its first real caller and its test. */
export type DamageTakenTargetSpec =
    | { kind: "permanent"; filter?: PermanentFilter }
    | { kind: "player"; player: PlayerFilter }
    | { kind: "any" };

export interface DamageTakenTriggerArgs {
    id: string;
    oracleText: string;
    /** Required receiver discriminator. */
    target: DamageTakenTargetSpec;
    /** Optional further constraints on the damage source's characteristics
     *  ("whenever ~ is dealt damage by a Red source", etc.). */
    sourceFilter?: DamageSourceFilter;
    /** Optional source-side scope ("whenever ~ is dealt damage by an opponent"
     *  vs "by any source"). Omitted = no constraint. */
    source?: DamageSourceScope;
    /** Only match combat damage when `true`, only non-combat when `false`. */
    isCombat?: boolean;
    /** Extra CR 603.4 check-time gate. */
    condition?: (
        event: DamageDealtEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if — re-checked at resolve time by the engine. */
    interveningIf?: (
        event: DamageDealtEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Effect to run when the trigger resolves. */
    resolve: (
        ctx: SpellContext,
        event: DamageDealtEvent,
        damage: DamageTriggerPayload
    ) => void;
}

export function damageTakenTrigger(
    args: DamageTakenTriggerArgs
): TriggeredAbility {
    const {
        id,
        oracleText,
        target,
        sourceFilter,
        source,
        isCombat,
        condition,
        interveningIf,
        resolve,
    } = args;

    function targetPasses(
        event: DamageDealtEvent,
        self: PermanentView,
        state: TriggerStateView | undefined
    ): boolean {
        // Exhaustive over `DamageTakenTargetSpec` (CLAUDE.md § Exhaustive
        // target-type matching). The mirror's `never` default is what makes a
        // future member a type error here rather than a silently inert kind
        // (the shape of issue #1855 on the dealt side).
        switch (target.kind) {
            case "any":
                return true;
            case "player":
                return passesTargetPlayerFilter(
                    event,
                    self,
                    state,
                    target.player
                );
            case "permanent":
                return passesTargetPermanentFilter(
                    event,
                    self,
                    state,
                    target.filter
                );
            default: {
                const exhaustive: never = target;
                return exhaustive;
            }
        }
    }

    function matches(
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean {
        if (!isDamageDealtEvent(event)) return false;
        if (isCombat !== undefined && event.isCombat !== isCombat) return false;
        if (!targetPasses(event, self, state)) return false;
        if (source !== undefined && !matchesSourceScope(event, self, source)) {
            return false;
        }
        if (!passesSourceFilter(event, self, sourceFilter)) return false;
        if (condition && !condition(event, self, state)) return false;
        if (interveningIf && !interveningIf(event, self, state)) return false;
        return true;
    }

    const ability: TriggeredAbility = {
        id,
        oracleText,
        event: "DAMAGE_DEALT",
        matches,
        resolve: (ctx: SpellContext, event: GameEvent) => {
            if (!isDamageDealtEvent(event)) return;
            resolve(ctx, event, buildDamagePayload(event));
        },
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
