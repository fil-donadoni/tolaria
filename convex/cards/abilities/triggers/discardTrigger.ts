// `discardTrigger` — declarative factory for CR 701.9 "whenever you discard a
// card" triggered abilities. Listens to CARD_DISCARDED, emitted by the engine's
// single discard choke point (`discardToGraveyard`), which every discard path
// flows through: the cleanup-step max-hand-size discard (CR 514.1), effect-
// driven discards (`discardCard` / `discardAtRandom`), and discard activation
// costs (Jandor's Ring, Coral Helm). The event fires AFTER the card lands in the
// graveyard, so the resolve body can act on it there (Necropotence — "exile that
// card from your graveyard"). Card authors describe whose discard counts (scope)
// and what to do; the factory narrows the event type and resolves the player
// scope so the per-card body never re-narrows.
//
// Scope semantics mirror the player-relation scopes used elsewhere:
//   * "your"      — only the source controller's discards (Necropotence).
//   * "each"      — any player's discard (the discarding player is passed through).
//   * "opponents" — only an opponent's discard.
//
// One CARD_DISCARDED event is emitted per discarded card, so the ability fires
// once per card discarded — matching "whenever you discard a card" oracle
// wording (a discard of N cards fires it N times, CR 603.3a). A "whenever you
// discard one or more cards" collapse is opt-in via `oncePerEventBatch`
// (CR 603.3b), which folds every CARD_DISCARDED event in one `collectTriggers`
// batch into a single firing.

import type {
    CardDiscardedEvent,
    GameEvent,
    PermanentView,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { withTriggerGate } from "./shared";

/** Whose discard fires the trigger, relative to the source's controller. */
export type DiscardTriggerScope = "your" | "each" | "opponents";

export interface DiscardTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** Relation between the discarding player and the source controller. */
    scope: DiscardTriggerScope;
    /** Optional CR 603.4 check-time predicate, after scope passes. */
    condition?: (
        event: CardDiscardedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if; re-evaluated at resolve time by the engine. */
    interveningIf?: (
        event: CardDiscardedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Resolution effect. Receives the typed event, the id of the player who
     *  discarded (resolved from scope), and the discarded card's instance id
     *  (now in that player's graveyard). */
    resolve: (
        ctx: SpellContext,
        event: CardDiscardedEvent,
        discardingPlayerId: string,
        discardedCardInstanceId: string
    ) => void;
    /** CR 603.3b — "whenever you discard ONE OR MORE cards": when a single
     *  action discards N cards (a cleanup-step hand-size discard, Bog Down),
     *  the engine emits N CARD_DISCARDED events into one `collectTriggers`
     *  batch; setting this collapses them into ONE firing. Leave unset for
     *  "whenever you discard a card" (per-card, the default). */
    oncePerEventBatch?: boolean;
}

/** True iff `discarderId` satisfies `scope` relative to the source controller. */
function discardScopeMatches(
    scope: DiscardTriggerScope,
    discarderId: string,
    selfControllerId: string
): boolean {
    if (scope === "your") return discarderId === selfControllerId;
    if (scope === "opponents") return discarderId !== selfControllerId;
    return true; // "each"
}

export function discardTrigger(args: DiscardTriggerArgs): TriggeredAbility {
    const discardMatches = (
        event: CardDiscardedEvent,
        self: PermanentView,
        state?: TriggerStateView
    ): boolean => {
        if (
            !discardScopeMatches(args.scope, event.playerId, self.controllerId)
        ) {
            return false;
        }
        if (args.condition && !args.condition(event, self, state)) return false;
        return true;
    };

    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "CARD_DISCARDED",
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "CARD_DISCARDED") return false;
            if (!discardMatches(event, self, state)) return false;
            // CR 603.4 — mirror the intervening-if into matches so the trigger
            // never enters the stack when already false at fire time.
            if (args.interveningIf && !args.interveningIf(event, self, state)) {
                return false;
            }
            return true;
        },
        resolve: (ctx, event) => {
            if (event.type !== "CARD_DISCARDED") return;
            args.resolve(ctx, event, event.playerId, event.cardInstanceId);
        },
        ...(args.oncePerEventBatch ? { oncePerEventBatch: true } : {}),
    };

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (event.type !== "CARD_DISCARDED") return false;
            return cb(event, self, state);
        };
    }

    return withTriggerGate(ability, args);
}
