// Suspend (CR 702.62) — the suspend special action and the suspended state.
//
// 702.62a "Suspend N—[cost]" means "If you could begin to cast this card by
//         putting it onto the stack from your hand, you may pay [cost] and
//         exile it with N time counters on it. This action doesn't use the
//         stack," and two exile-zone triggered abilities (the upkeep tick and
//         the free play when the last time counter is removed).
// 702.62b A card is "suspended" if it's in the exile zone, has suspend, and has
//         a time counter on it.
// 702.62c While determining if you could begin to cast a card with suspend,
//         take into consideration any effects that would prohibit that card
//         from being cast.
// 702.62d Casting a spell as an effect of its suspend ability follows the rules
//         for paying alternative costs in rules 601.2b and 601.2f–h.
// 116.2f  A player who has a card with suspend in their hand may exile that
//         card. This is a special action. A player can take this action any
//         time they have priority, but only if they could begin to cast that
//         card by putting it onto the stack.
//
// Two halves, two homes — Plot's arrangement (`gre/plot.ts`):
//   1. The SPECIAL ACTION (702.62a first ability, 116.2f) is this module: the
//      cost is `CardDefinition.suspend`, N is the `"suspend N"` keyword
//      string, legality is {@link canSuspend}, the commit is
//      {@link applySuspend} (the `suspendCard` mutation, `convex/game.ts`) and
//      {@link suspendInSearch} (the Bot's sandboxes). The cost is auto-tapped
//      and paid in the one call that takes the action, like plot.
//   2. The two TRIGGERED abilities are data injected at the `getDefinition`
//      seam (`convex/cards/abilities/suspend.ts`); the SUSPENDED state
//      (702.62b) is derived, never stored — exile + the keyword + a time
//      counter ({@link isSuspendedCard}).
//
// 702.62c is "could begin to cast", which is the hand cast's TIMING and its
// PROHIBITIONS, and nothing about paying: CR 601.2a begins a cast by moving
// the card to the stack, before any cost is determined, so a card with no
// mana cost (Living End) can be suspended although it can never be cast from
// hand. Read through the same authorities `getLegalActions` asks
// (`castTimingBaseLegal`, `passesCastPhaseRestriction`,
// `castProhibitionReason`), so an instant suspends at instant speed, a split
// second spell on the stack forbids it, and a "can't cast" lock forbids it.
// 702.62d is the free cast's: `castChosenSpell` with `free: true`.
import { tryGetDefinition } from "../cards";
import { parseSuspend, SUSPEND_TIME_COUNTER } from "../cards/abilities/suspend";
import { castProhibitionReason } from "../cards/castRestrictions";
import type { ManaCost } from "../cards/types";
import type { AutoTapPlan } from "./autoTap";
import { computeExpectedInput } from "./expectedInput";
import { castTimingBaseLegal, passesCastPhaseRestriction } from "./rules";
import { checkStateBasedActionsAfterSpecialAction } from "./sba";
import {
    paySpecialActionManaCost,
    specialActionPaymentPlan,
} from "./specialActionPayment";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { emitCardsExiled, getPlayer, moveCard } from "./state";

/** CR 702.62a — the suspend cost and N of `card`, read off its definition, or
 *  `undefined` for a card without suspend. */
export function getSuspend(
    card: CardInstanceState
): { cost: ManaCost; timeCounters: number } | undefined {
    const def = tryGetDefinition((card.card as { id?: string }).id ?? "");
    if (def?.suspend === undefined) return undefined;
    const timeCounters = parseSuspend(def.staticAbilities);
    if (timeCounters === null) return undefined;
    return { cost: def.suspend, timeCounters };
}

/** CR 702.62b — `card` (an exiled card) is suspended: it has suspend and a
 *  time counter on it. The caller vouches for the zone. */
export function isSuspendedCard(card: CardInstanceState): boolean {
    return (
        parseSuspend(card.staticAbilities) !== null &&
        (card.counters?.[SUSPEND_TIME_COUNTER] ?? 0) > 0
    );
}

/** The auto-tap plan that pays `card`'s suspend cost, or `null` when it
 *  cannot be paid. Shared by {@link canSuspend} and {@link applySuspend} so
 *  "the action is offered" and "the payment succeeds" are one decision. */
export function suspendPaymentPlan(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): AutoTapPlan | null {
    const suspend = getSuspend(card);
    if (!suspend) return null;
    return specialActionPaymentPlan(state, player, suspend.cost);
}

/** CR 702.62a / 702.62c / 116.2f — `player` could begin to cast `card` by
 *  putting it onto the stack from their hand right now: the card's own timing
 *  (instant speed or the sorcery window, flash grants and sorcery-speed locks
 *  included), its phase restriction, and every cast prohibition. Nothing
 *  about the cost — beginning a cast precedes paying for it (CR 601.2a). */
function couldBeginToCastFromHand(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    return (
        castTimingBaseLegal(state, player.id, card, "hand") &&
        passesCastPhaseRestriction(state, card) &&
        castProhibitionReason(player.id, card, state) === undefined
    );
}

/** CR 702.62a / 116.2f — true iff `player` may suspend `card` right now: a
 *  card with suspend in their own hand, while they hold priority outside any
 *  pending payment or choice, when they could begin to cast it from hand
 *  (CR 702.62c), with the suspend cost affordable.
 *
 *  Single source of truth for the Bot enumerator (`moves.ts`), the wire
 *  affordance (`canSuspend` on the hand card, `gameProjections.ts`) and the
 *  `suspendCard` mutation. */
export function canSuspend(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    if (state.gameOver || state.phase === "MULLIGAN") return false;
    if (state.priorityPlayerId !== player.id) return false;
    if (!player.hand.some((c) => c.id === card.id)) return false;
    if (getSuspend(card) === undefined) return false;
    if (
        state.pendingCast ||
        state.pendingActivation ||
        state.pendingCompanionPay ||
        state.pendingTarget ||
        (state.pendingChoices && state.pendingChoices.length > 0)
    ) {
        return false;
    }
    if (computeExpectedInput(state)?.kind !== "priority") return false;
    if (!couldBeginToCastFromHand(state, player, card)) return false;
    return suspendPaymentPlan(state, player, card) !== null;
}

/** Every card in `player`'s hand they may suspend right now (CR 702.62a). */
export function suspendableHandCards(
    state: GameState,
    player: PlayerState
): CardInstanceState[] {
    return player.hand.filter((c) => canSuspend(state, player, c));
}

/** The hand → exile move with N time counters, shared by the real commit and
 *  the search sandbox. Exiled face up (CR 406.3): a suspended card is public.
 *  Returns the exiled card. */
function exileWithTimeCounters(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string,
    timeCounters: number
): CardInstanceState {
    const exiled = moveCard(player, cardInstanceId, "hand", "exile");
    delete exiled.faceDown;
    delete exiled.faceDownBy;
    // CR 702.62a — "exile it with N time counters on it".
    exiled.counters = {
        ...(exiled.counters ?? {}),
        [SUSPEND_TIME_COUNTER]: timeCounters,
    };
    // CR 603.2 — "whenever one or more cards are put into exile" watchers see
    // the suspend exile like any other.
    emitCardsExiled(state, [
        {
            cardInstanceId: exiled.id,
            cardId: (exiled.card as { id?: string }).id,
            fromZone: "hand",
            ownerId: exiled.ownerId,
        },
    ]);
    return exiled;
}

/** The whole CR 116.2f / 702.62a special action as a PURE state transition:
 *  re-check legality, pay the suspend cost, exile the card with N time
 *  counters, restart the pass cycle and keep priority with the actor (CR
 *  116.3). Throws on every illegal input; the `suspendCard` mutation adds
 *  only auth, the clone and the save. */
export function applySuspend(
    state: GameState,
    playerId: string,
    cardInstanceId: string
): void {
    const player = getPlayer(state, playerId);
    const card = player.hand.find((c) => c.id === cardInstanceId);
    if (!card) throw new Error("Card not found in hand");
    if (!canSuspend(state, player, card)) {
        throw new Error("Can't suspend that card right now");
    }
    const plan = suspendPaymentPlan(state, player, card);
    const suspend = getSuspend(card);
    if (plan === null || suspend === undefined) {
        throw new Error("Can't afford the suspend cost");
    }
    paySpecialActionManaCost(state, player, suspend.cost, plan);
    exileWithTimeCounters(state, player, cardInstanceId, suspend.timeCounters);
    checkStateBasedActionsAfterSpecialAction(state, playerId);
}

/** CR 116.2f — the suspend special action inside a search sandbox. The coarse
 *  mana model every sandboxed special action uses (`plotInSearch`): taps the
 *  planned sources without draining the pool — legality and affordability
 *  were established by {@link canSuspend} at enumeration time. The caller
 *  owns the priority bookkeeping. */
export function suspendInSearch(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): void {
    const card = player.hand.find((c) => c.id === cardInstanceId);
    if (!card) return;
    const suspend = getSuspend(card);
    if (!suspend) return;
    const plan = suspendPaymentPlan(state, player, card);
    if (plan) {
        const tapped = new Set(plan.map((step) => step.cardId));
        const srcList = player.battlefield;
        for (let i = 0; i < srcList.length; i++) {
            const src = srcList[i];
            if (tapped.has(src.id)) src.isTapped = true;
        }
    }
    exileWithTimeCounters(state, player, cardInstanceId, suspend.timeCounters);
}
