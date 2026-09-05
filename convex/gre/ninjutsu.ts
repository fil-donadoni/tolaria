// Ninjutsu (CR 702.49) — the engine half of the keyword.
//
// CR 702.49a: "Ninjutsu [cost]" means "[Cost], Reveal this card from your hand,
//   Return an unblocked attacking creature you control to its owner's hand: Put
//   this card onto the battlefield from your hand tapped and attacking."
//   The ability functions only while the card with ninjutsu is in a player's
//   hand.
// CR 702.49b: the card stays revealed from announcement until the ability
//   leaves the stack.
// CR 702.49c: the creature put onto the battlefield enters attacking the same
//   player, planeswalker or battle as the creature that was returned.
//
// It is an ACTIVATED ability, not a special action: it is announced, uses the
// stack, and can be responded to. So nothing here is a new activation path —
// the whole keyword rides seams that already exist:
//
//   - `ActivatedAbility.activateFromHand` (Cycling's seam) makes the ability
//     findable and legal while its source sits in hand.
//   - `ActivatedAbility.cost.returnUnblockedAttacker` is the non-mana cost leg,
//     paid through the ONE unified give-up-a-permanent selection layer
//     (`sacrificeChoice.ts`, `action: "return"`) so the payer picks WHICH
//     attacker goes back.
//   - the ability's BODY is a plain Effect Script: `moveZone` from the hand
//     carrier, with the `tapped` and `attacking` riders. No keyword-shaped Op
//     was added — the zone move is the one `moveZone` already owned, reached
//     from a bare `$source` instead of a `choice` Op's picks.
//
// This module owns the two facts none of those seams can answer on their own:
// which creatures the cost may legally return, and which defender the entering
// ninja inherits.

import type { CardInstanceState, GameState } from "./state";
import type { UnblockedAttackerScope } from "./combat";
import { unblockedAttackerIds } from "./combat";
import type {
    SacrificeRequirement,
    SacrificeSelection,
} from "./sacrificeChoice";

/** CR 702.49a / 509.1h — the creatures `playerId` may return to pay a ninjutsu
 *  cost right now.
 *
 *  Gated on `blockersConfirmed` because CR 509.1h makes an attacker neither
 *  blocked nor unblocked until the declare-blockers step: before blockers are
 *  declared there is no such thing as "an unblocked attacking creature", so
 *  there is nothing the cost may name. That is the whole of ninjutsu's timing
 *  window — the keyword itself carries no phase restriction, and deriving the
 *  window from the cost rather than restating it as a second rule is what keeps
 *  the two from drifting apart.
 *
 *  The single authority: the mutation's legality gate, the cost's candidate
 *  picker and the Bot's move enumerator all call this, so none of them can
 *  offer an activation another one refuses. */
export function ninjutsuReturnCandidateIds(
    state: UnblockedAttackerScope,
    playerId: string
): string[] {
    if (!state.combat?.blockersConfirmed) return [];
    return unblockedAttackerIds(state, playerId);
}

/** The CR 702.49a return requirement, narrowed to the live candidate set.
 *
 *  `filter` stays the plain creature type line that names the cost in the
 *  banner ("return a creature"); `candidateIds` is what actually constrains it,
 *  because "unblocked" is a fact about `combat.blockedAttackerIds` (ADR 0019)
 *  and not about any permanent. */
export function ninjutsuReturnRequirement(
    state: GameState,
    playerId: string
): SacrificeRequirement {
    const candidateIds = ninjutsuReturnCandidateIds(state, playerId);
    return {
        filter: { types: ["Creature"] },
        count: 1,
        candidateIds,
        // CR 702.49a — the creature goes to its owner's HAND, not a graveyard.
        // Declared per-REQUIREMENT rather than on the selection so this leg can
        // share one payment with a static additional-SACRIFICE tax the same
        // activation owes (Drought).
        action: "return" as const,
        // ADR 0079 — opt OUT of `autoResolveFungible` as soon as there is more
        // than one candidate. The default fungibility test (`identityKey`:
        // same card, same tapped state, no counters, no attachments) would
        // collapse two identical unblocked attackers into an arbitrary pick,
        // and for THIS cost they are not interchangeable: CR 702.49c gives the
        // ninja the defender of whichever creature is returned, so two
        // identical bears attacking two different planeswalkers are two
        // different plays. The fungibility rule is right for a sacrifice, where
        // nothing downstream reads the victim's combat role; it is wrong here,
        // and the narrow fix belongs on this requirement rather than in
        // `identityKey`, which every other cost shares.
        //
        // A SINGLE candidate is still auto-resolved: there is no choice to
        // make and no defender ambiguity to resolve.
        ...(candidateIds.length > 1 ? { explicit: true } : {}),
    };
}

/** CR 702.49c — stamp the defender the returned creature was attacking onto the
 *  ninjutsu source card, so the Op that puts it onto the battlefield attacking
 *  can join combat against the SAME player or planeswalker.
 *
 *  MUST run before the selection is applied: returning the creature to hand
 *  removes it from combat (CR 506.4c), taking its `combat.attackTargets` entry
 *  with it. A returned creature that was attacking a PLAYER has no entry there
 *  at all, which is why the absent stamp means "the defending player" rather
 *  than "unknown" — and why the stamp is cleared rather than left stale when a
 *  second activation finds no planeswalker target. */
export function captureNinjutsuAttackTarget(
    state: GameState,
    source: CardInstanceState,
    selection: SacrificeSelection | undefined
): void {
    const returnedId = selection?.picked[0];
    const target = returnedId
        ? state.combat?.attackTargets?.[returnedId]
        : undefined;
    if (target) {
        source.enterAttackingTarget = target;
    } else {
        delete source.enterAttackingTarget;
    }
}
