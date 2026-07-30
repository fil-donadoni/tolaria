// `lifeLostTrigger` — declarative factory for CR 119.3 "whenever you lose life"
// triggered abilities. Listens to LIFE_LOST, emitted by the engine's life-loss
// choke points: the `loseLifeEmitting` helper (the `loseLife` primitive and
// paid life costs, CR 118.4) and every damage-to-player sink (CR 119.3 —
// combat, noncombat, and reflected damage), which all call `emitLifeLost`
// AFTER the player's life total has actually dropped. Card authors describe
// whose loss counts (scope) and what to do; the factory narrows the event type
// and resolves the player scope so the per-card body never re-narrows.
//
// Scope semantics mirror the player-relation scopes used elsewhere:
//   * "your"      — only the source controller's life loss (Oath of Lim-Dûl).
//   * "each"      — any player's life loss (the losing player is passed through).
//   * "opponents" — only an opponent's life loss.
//
// One LIFE_LOST event is emitted per life-loss occurrence, carrying the ACTUAL
// amount lost (post-replacement, post-prevention). The ability fires once per
// occurrence; the `amount` is handed to the resolve body so "for each 1 life
// you lost, ..." effects (Oath of Lim-Dûl) can loop over it.

import type {
    GameEvent,
    LifeLostEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Whose life loss fires the trigger, relative to the source's controller. */
export type LifeLostTriggerScope = "your" | "each" | "opponents";

export interface LifeLostTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** Relation between the losing player and the source controller. */
    scope: LifeLostTriggerScope;
    /** Optional CR 603.4 check-time predicate, after scope passes. */
    condition?: (
        event: LifeLostEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if; re-evaluated at resolve time by the engine. */
    interveningIf?: (
        event: LifeLostEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution effect. Receives the typed event, the id of the player who
     *  lost life (resolved from scope), and the amount lost. */
    resolve: (
        ctx: SpellContext,
        event: LifeLostEvent,
        losingPlayerId: string,
        amount: number
    ) => void;
}

/** True iff `loserId` satisfies `scope` relative to the source's controller. */
function lifeLossScopeMatches(
    scope: LifeLostTriggerScope,
    loserId: string,
    selfControllerId: string
): boolean {
    if (scope === "your") return loserId === selfControllerId;
    if (scope === "opponents") return loserId !== selfControllerId;
    return true; // "each"
}

export function lifeLostTrigger(args: LifeLostTriggerArgs): TriggeredAbility {
    const lifeLossMatches = (
        event: LifeLostEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (
            !lifeLossScopeMatches(args.scope, event.playerId, self.controllerId)
        ) {
            return false;
        }
        if (args.condition && !args.condition(event, self, state)) return false;
        return true;
    };

    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "LIFE_LOST",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "LIFE_LOST") return false;
            if (!lifeLossMatches(event, self, state)) return false;
            // CR 603.4d — mirror the intervening-if into matches so the trigger
            // never enters the stack when already false at fire time.
            if (args.interveningIf && !args.interveningIf(event, self, state)) {
                return false;
            }
            return true;
        },
        resolve: (ctx, event) => {
            if (event.type !== "LIFE_LOST") return;
            args.resolve(ctx, event, event.playerId, event.amount);
        },
    };

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "LIFE_LOST") return false;
            return cb(event, self, state);
        };
    }

    return withTriggerGate(ability, args);
}
