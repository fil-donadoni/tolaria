// Warp (CR 702.185) — a keyword that lets a card be cast from hand for a
// cheaper alternative cost, takes the permanent away again at the beginning of
// the next end step, and leaves the card castable from exile from the FOLLOWING
// turn onward, for as long as it stays there.
//
// 702.185a Warp represents two static abilities that function while the card
//          with warp is on the stack, one of which may create a delayed
//          triggered ability. "Warp [cost]" means "You may cast this card from
//          your hand by paying [cost] rather than its mana cost" and "If this
//          spell's warp cost was paid, exile the permanent this spell becomes
//          at the beginning of the next end step. Its owner may cast this card
//          after the current turn has ended for as long as it remains exiled."
//          Casting a spell for its warp cost follows the rules for paying
//          alternative costs in rules 601.2b and 601.2f-h.
// 702.185b Some effects refer to "warped" cards in exile. A warped card in
//          exile is one that was exiled by the delayed triggered ability
//          created by a warp ability.
// 702.185c Some effects refer to whether "a spell was warped this turn." This
//          means that a spell was cast for its warp cost this turn.
//
// Three halves, three homes:
//   1. The alternative CAST cost is cost-system infra, not this file:
//      `CardDefinition.warp` reuses the `AlternativeCost` shape verbatim (the
//      `dash` precedent — a pure MANA leg), is resolved by
//      `getAlternativeCost` / `affordableAlternativeCosts`
//      (`gre/alternativeCost.ts`) alongside every other alt cost, and is
//      identified at cast commit by reference so the resulting stack item is
//      stamped `warped: true` (`convex/game.ts`, and the cast-mode census
//      `gre/castMode.ts` for the two search executors). That flag rides onto
//      the entering permanent for free — a stack item IS its
//      `CardInstanceState`, the same object, the `evoked`/`dashed` precedent.
//   2. The delayed EXILE is this file, scheduled the moment the permanent
//      enters (`scheduleWarpExile`, called from `finalizeSpellResolution`) and
//      fired by the delayed-trigger infra at the next end step.
//   3. The RECAST permission is the existing `castableFromExileBy` grant plus
//      the new LOWER turn bound `castableFromExileFromTurn` — a general rider,
//      never a Warp-specific field, honoured at the one shared authority
//      `exileCastPermission` (`gre/castCost.ts`) every consumer reads.
//
// Why engine infra and not a `warpTrigger` DSL template the way Dash is
// (`convex/cards/abilities/dash.ts`): CR 400.7. The ability exiles "the
// permanent this spell BECOMES", so at fire time it must decide whether the
// object standing under that id is still the same one — a permanent that left
// the battlefield and returned is a NEW object and must not be chased — and no
// check-time predicate available to a delayed body can ask that question. The
// answer lives in the marker itself: `resetBattlefieldTransientState` clears
// `warped` on the way out, so "still on the battlefield under this id AND still
// `warped`" is exactly CR 400.7's "the same object", in one line. The scheduling
// and firing shape is otherwise Rebound's verbatim (`gre/rebound.ts`): a
// `DelayedTriggerInstance` marker (`warpCardInstanceId`), a synthetic StackItem
// built at fire time (`buildWarpExileTrigger`, `gre/triggers.ts`), and an
// engine-owned resolution branch in `resolveTopOfStackInner`.
import { tryGetDefinition } from "../cards";
import type { CardInstanceState, GameState } from "./state";
import { emitCardsExiledFromBattlefield, removePermanentTo } from "./state";

/** CR 702.185 — true iff `def`'s card declares the `warp` keyword. Read off the
 *  registry rather than off a live instance, so it answers for a card in any
 *  zone. The COST half is `CardDefinition.warp`; a card declaring the keyword
 *  without one is a definition bug the Mechanics Registry guard (Guard A) and
 *  the card's own `warp` field together make loud. */
export function hasWarp(cardId: string | undefined): boolean {
    if (!cardId) return false;
    return tryGetDefinition(cardId)?.staticAbilities?.includes("warp") ?? false;
}

/** CR 702.185a — the second static ability, at the moment it can first do
 *  anything: the warp spell has resolved and the permanent it became has just
 *  entered, so "if this spell's warp cost was paid" is decided (the `warped`
 *  marker rode the stack item onto the permanent) and the delayed triggered
 *  ability is created.
 *
 *  Called from `finalizeSpellResolution` (`gre/state.ts`) at the battlefield
 *  entry, and a no-op for a permanent whose spell paid any other cost. The
 *  instance is scheduled EVEN IF the permanent is destroyed in response: the
 *  ability was created by the resolving spell, it triggers at the next end step
 *  regardless, and it simply finds nothing to exile (CR 603.10) — which is why
 *  the liveness question belongs at fire time and not here.
 *
 *  `watchInstanceId` is set alongside the warp marker purely as documentation of
 *  the subject; the `leaves-battlefield` timing is what consumes that field, and
 *  this instance's timing is `next-end-step`. */
export function scheduleWarpExile(
    state: GameState,
    permanent: CardInstanceState
): void {
    state.nextDelayedSeq = (state.nextDelayedSeq ?? 0) + 1;
    state.delayedTriggers = [
        ...(state.delayedTriggers ?? []),
        {
            id: `delayed-${state.nextDelayedSeq}`,
            sourceCardId: (permanent.card as { id?: string }).id ?? "",
            triggerId: WARP_EXILE_TRIGGER_ID,
            // CR 702.185a — "its OWNER may cast this card": the delayed ability
            // belongs to the warp card's owner, and the recast permission it
            // opens names that same player. For every cast this engine can make
            // today the owner is also the caster; keying on the owner is what
            // keeps the two clauses from disagreeing if that ever stops being
            // true (CR 400.7 — the card is exiled into its OWNER's exile).
            controller: permanent.ownerId,
            timing: "next-end-step",
            payload: {},
            warpCardInstanceId: permanent.id,
        },
    ];
}

/** The `triggerId` every warp delayed instance carries. No card definition
 *  declares a `delayedTriggers` entry under it — the body is this module — but
 *  the field is not optional on the instance, and a stable id is what makes a
 *  scheduled warp exile recognisable in a serialized state. */
export const WARP_EXILE_TRIGGER_ID = "warp-exile";

/** CR 702.185a resolution — "exile the permanent this spell becomes … its owner
 *  may cast this card after the current turn has ended for as long as it
 *  remains exiled".
 *
 *  `permanentId` is the instance the trigger was scheduled against. CR 400.7 is
 *  decided by the two-part find below, and the second half is the load-bearing
 *  one: a permanent that LEFT the battlefield is gone (nothing happens, CR
 *  603.10), and one that left and RETURNED is a new object whose `warped` marker
 *  `resetBattlefieldTransientState` cleared on the way out — so it is found by
 *  id and rejected by the marker, and the original trigger does not chase it.
 *
 *  Returns true iff a permanent was actually exiled. */
export function applyWarpExile(state: GameState, permanentId: string): boolean {
    const subject = state.players
        .flatMap((p) => p.battlefield)
        .find((c) => c.id === permanentId && c.warped === true);
    if (!subject) return false;
    // CR 701.13 / 603.10 — the SAME battlefield-departure funnel every other
    // exile effect uses, never a hand-rolled splice: aura/equipment cleanup (CR
    // 704.5m/n), counter loss (CR 122.1e), the PERMANENT_LEFT event that
    // leaves-the-battlefield triggers read, an `exileOnLeave` redirect and the
    // CR 400.7 transient-state reset all live behind it — including the
    // `warped` clear itself, which is why the marker is read ABOVE this call.
    const moved = removePermanentTo(state, permanentId, "exile");
    if (!moved || moved.zone !== "exile") return false;
    emitCardsExiledFromBattlefield(state, moved);
    // CR 702.185b — "a warped card in exile is one that was exiled by the
    // delayed triggered ability created by a warp ability". This IS that
    // ability, and this is the only moment the fact is observable.
    moved.warpExiled = true;
    // CR 702.185a — "its owner may cast this card AFTER THE CURRENT TURN HAS
    // ENDED for as long as it remains exiled": an open-ended grant (no expiry)
    // that has not OPENED yet. The recast is an ordinary cast for the printed
    // mana cost — no waiver rider — and it is not "cast from your hand", so it
    // never warps again and schedules no second exile.
    moved.castableFromExileBy = moved.ownerId;
    moved.castableFromExileFromTurn = state.turn + 1;
    return true;
}
