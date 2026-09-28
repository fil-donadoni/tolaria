// The DEFERRAL PERIMETER (issue #4764, PRD #4754) — which actions "keep mana
// open, act in the last window" is a statement about, and which window is the
// last one.
//
// Two consumers share it, and that is why it is one module rather than a
// clause in each:
//
//   * the Verdict lowering (`verdicts/evalPairs.ts`) — a pair "pass over a
//     deferrable action" in an earlier window, or "a deferrable action over
//     pass" in the last one, is a TIMING judgement. Acting now and acting at
//     the last window reach the same board when nothing happens in between, so
//     the Weight Fit, which reads a position's terms and never its window, can
//     only answer it by bending material weights. Such a pair yields no Eval
//     Pair; the report lists it as checked by the search instead.
//   * the root rule of issue #4757 — the same perimeter decides which actions
//     wait for the last window at the root.
//
// A predicate the two disagreed on would let the fit and the root rule each
// claim the other owns a position — so the perimeter is asked here, once.
//
// FAIL-CLOSED, and the direction is chosen by both consumers at once: `false`
// ("not deferrable") leaves a pair in the fit and a decision to the search,
// which is exactly what happened before this module existed. Every doubt — an
// unknown card, a move kind this module cannot read, an opposing object it
// might reach — answers `false`.

import { tryGetDefinition } from "../../cards";
import type { TargetSelection } from "../../cards/types";
import { hasInstantSpeed } from "../constants";
import type { Move } from "../moves";
import { getLegalTargets, targetingSourceFromCard } from "../rules";
import type { CardInstanceState, GameState } from "../state";
import { effectiveAbilityOf, isDeferrableStackAbility } from "./abilityTiming";

/** Whether `pid` is at the LAST priority window of this turn cycle in which
 *  deferring still costs nothing — the opponent's end step (CR 513.1, issue
 *  #2939). "The last window before the bot's own turn" is the normal case, not
 *  an invariant: an extra turn taken by the opponent makes this one cycle
 *  early, which converts sooner than strictly necessary and never later.
 *
 *  Deliberately not "any window on the opponent's turn": the end step is the
 *  one where every threat and answer of the turn is already known, which is the
 *  whole payoff the hold rule defers FOR. Anything earlier still has
 *  information left to buy. */
export function isLastDeferralWindow(state: GameState, pid: string): boolean {
    return state.phase === "END_STEP" && state.activePlayerId !== pid;
}

/**
 * Is `move` a DEFERRABLE action for `pid` — one whose only question is WHEN,
 * because a later window offers the same action on the same board?
 *
 * Four clauses, all required:
 *
 *  1. **Instant timing.** A cast of a card with instant speed
 *     (`hasInstantSpeed`: an Instant, or Flash — CR 117.1a / 702.8a), or an
 *     activation `isDeferrableStackAbility` admits (a stack ability with no
 *     timing restriction, CR 117.1b / 602.5). Anything else may have no later
 *     window at all.
 *  2. **Own side only.** Every object the action names is its controller's
 *     own — see {@link reachesOnlyOwnSide}. Removal and burn are OUT: their
 *     timing is the search's, whose leaves simulate the opponent's turn.
 *  3. **Not a response** — the stack is empty. With something on it, "later"
 *     is after that object resolves, a different board (counters and
 *     responses are the search's).
 *  4. **No attack declared** (CR 506.1 / 508.1) — a combat trick's window is
 *     combat itself; that is the search's too.
 */
export function isDeferrableAction(
    state: GameState,
    pid: string,
    move: Move
): boolean {
    if (state.stack.length > 0) return false;
    if ((state.combat?.attackerIds.length ?? 0) > 0) return false;
    const player = state.players.find((p) => p.id === pid);
    if (!player) return false;
    if (move.kind === "cast-spell") {
        const card = castCardOf(player, move.cardInstanceId);
        if (!card || !hasInstantSpeed(card)) return false;
        return reachesOnlyOwnSide(state, pid, move.targets, card);
    }
    if (move.kind === "activate-ability") {
        const source = player.battlefield.find(
            (c) => c.id === move.cardInstanceId
        );
        if (!source) return false;
        const ability = effectiveAbilityOf(source, move.abilityId);
        if (!ability || !isDeferrableStackAbility(ability)) return false;
        return reachesOnlyOwnSide(state, pid, move.targets);
    }
    return false;
}

/** The card a cast names, from any zone a cast may come from (hand, and the
 *  graveyard / exile / library permissions — `CastFromZone`). */
function castCardOf(
    player: GameState["players"][number],
    id: string
): CardInstanceState | undefined {
    for (const zone of [
        player.hand,
        player.graveyard,
        player.exile,
        player.library,
    ]) {
        const card = zone.find((c) => c.id === id);
        if (card) return card;
    }
    return undefined;
}

/**
 * Clause 2: does the action name only its controller's own objects?
 *
 * Why not one of the own-side predicates `search.ts` already has (issue #4764
 * asked for a reuse "after checking it answers this question" — neither does):
 *
 *  - `targetsOnlyOwnPermanents` is a CAST-only, PERMANENT-only test that is
 *    `false` for a move with no target at all — the draw instant, the flash
 *    body, the fetch crack are exactly the untargeted shapes this perimeter
 *    exists for;
 *  - `reachesOnlyOwnSideThroughChoice` answers "self-confined AND futile"
 *    (`isSelfConfinedFutileMove` requires a do-nothing branch) through a probe
 *    that refuses every permanent spell, so every flash creature fails it.
 *
 * So it is read off the objects the action NAMES:
 *
 *  - every announced target is the controller's own — its own player, a
 *    permanent it controls, a card in its own graveyard or hand. A stack
 *    target is never own-side here (clause 3 empties the stack anyway);
 *  - a permanent spell's entering triggers (`PERMANENT_ENTERED` — the ETB
 *    Ability and any "whenever a … enters" it would fire on itself) choose
 *    their targets later (CR 603.3d), so the Move cannot carry them: they are
 *    asked of the CURRENT board through `getLegalTargets`, the targeting
 *    authority, and one legal opposing target makes the cast reach the
 *    opponent. A Snapcaster whose ETB can only point at its own graveyard
 *    stays deferrable; a Flametongue Kavu facing an opposing creature does
 *    not.
 *
 * KNOWN LIMIT, stated rather than hidden: an UNTARGETED effect that reaches
 * the opponent ("each opponent loses 1 life", a symmetric sweep at instant
 * speed) names no object and passes this clause. If a verdict ever shows
 * one, a resolution probe of the opponent's record is the widening.
 */
export function reachesOnlyOwnSide(
    state: GameState,
    pid: string,
    targets: readonly TargetSelection[],
    castCard?: CardInstanceState
): boolean {
    if (!targets.every((t) => isOwnSideTarget(state, pid, t))) return false;
    if (!castCard) return true;
    const cardId = (castCard.card as { id?: string } | undefined)?.id;
    const def = cardId ? tryGetDefinition(cardId) : undefined;
    if (!def) return false;
    const source = targetingSourceFromCard(castCard, false);
    for (const trigger of def.triggeredAbilities ?? []) {
        const events = Array.isArray(trigger.event)
            ? trigger.event
            : [trigger.event];
        if (!events.includes("PERMANENT_ENTERED")) continue;
        if (!trigger.targetRequirement) continue;
        const legal = getLegalTargets(
            state,
            trigger.targetRequirement,
            source,
            pid
        );
        if (!legal.every((t) => isOwnSideTarget(state, pid, t))) return false;
    }
    return true;
}

function isOwnSideTarget(
    state: GameState,
    pid: string,
    target: TargetSelection
): boolean {
    switch (target.type) {
        case "player":
            return target.id === pid;
        case "permanent": {
            const me = state.players.find((p) => p.id === pid);
            return !!me?.battlefield.some((c) => c.id === target.id);
        }
        case "graveyard-card":
        case "hand-card":
            return target.playerId === pid;
        case "spell":
            return false;
    }
}
