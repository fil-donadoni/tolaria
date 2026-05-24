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
} from "./shared";

/** Discriminator over the side that took the damage. Required — the whole
 *  point of `damageTakenTrigger` is to gate on the receiver. Use a
 *  `PermanentFilter` with `controllerRelation: "self"` for the canonical
 *  "whenever this creature is dealt damage" case (CR 109.2). */
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
    /** CR 603.4d intervening-if — re-checked at resolve time by the engine. */
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
        if (target.kind === "any") return true;
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
    return ability;
}
