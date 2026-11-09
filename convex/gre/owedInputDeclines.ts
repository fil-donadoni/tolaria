// Auth-free decline cores (issue #9001, PRD issue #8998 — Bot liveness).
//
// Every "decline" or "default" answer an owed input admits, as a plain
// `(state, playerId) → DeclineOutcome` over a `GameState`, with no Convex
// context: pass priority, confirm (or declare no) blockers, decline the attack
// mana tax, cancel a raised or announced target, rewind a cast or activation
// announcement. The public `convex/game.ts` mutations run the seat-ownership
// check (`assertCallerOwnsSeat`), clone the stored state, call the core, and
// save; a server-side caller with no `ctx.auth` (a scheduled function) runs the
// SAME core. The rules live here once — never a second copy in a mutation.
//
// Each core mutates `state` IN PLACE and either throws (the input is not
// legal now — the caller discards its clone, exactly as a mutation does) or
// returns whether it changed the state, so a caller can tell progress from a
// no-op.
import {
    abandonPendingPayment,
    rollbackPendingActivation,
    rollbackPendingCast,
    untapSourceFromPayment,
} from "./paymentRollback";
import {
    assertGameNotOver,
    assertNoPendingChoices,
    isInlineManaAbilityPark,
} from "./activation";
import { chargeManaCostOrThrow } from "./autoCharge";
import { applyMeleeUnblockedRider, recordBlockedAttackers } from "./banding";
import { clearDeclinedExileRoute } from "./castCost";
import {
    collectBlockBypassCharges,
    foldBlockRequirements,
    getBlockDeclarerId,
    markDeclaredBlockers,
    validateDeclaredBlockers,
    validateMinimumBlockers,
} from "./combat";
import { assertExpectedInput } from "./expectedInput";
import { getOpponentId, getPlayer } from "./lookup";
import { sweepUnlessResolutionSuspended } from "./pendingChoiceResume";
import {
    applyRaisedTargetFinalization,
    continueAfterRetargetOffer,
} from "./pendingTargetOrigin";
import {
    advancePhase,
    drainAutoPasses,
    emitBlockersConfirmedEvents,
} from "./phases";
import { raiseTriggerTargetSelection } from "./rules";
import { resolveTopOfStack, type GameState } from "./state";

/** Why a decline core changed nothing. `not-priority-holder` — a pass from a
 *  player who does not hold priority (ADR 0047 "waiting for another player"):
 *  a harmless misclick for a human, a stale request for a scheduler. */
export type DeclineNoOpReason = "not-priority-holder";

/** What a decline core did: `changed` when it advanced the state, else the
 *  reason it was a no-op. An illegal decline throws instead. */
export type DeclineOutcome =
    | { changed: true }
    | { changed: false; reason: DeclineNoOpReason };

/** Pass priority (CR 117.3d / 117.4). Both players passing in succession
 *  resolves the top of the stack, or — with an empty stack — ends the step
 *  (CR 500.2). A pass from a player who does not hold priority is a no-op
 *  reported as `not-priority-holder`, checked BEFORE `assertExpectedInput`,
 *  whose wrong-player throw would otherwise shadow it. */
export function passPriorityOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    assertGameNotOver(state);

    if (state.priorityPlayerId !== playerId) {
        return { changed: false, reason: "not-priority-holder" };
    }

    assertExpectedInput(state, {
        playerId,
        expect: "priority",
    });
    assertNoPendingChoices(state);

    // CR 103.5: no priority is given during the pre-game mulligan phase.
    if (state.phase === "MULLIGAN") {
        throw new Error("Cannot pass priority during mulligan phase");
    }

    // Passing priority while a mana payment is still open abandons it
    // (CR 601.2 / 602.2): roll back the tapped lands and clear the banner
    // before the priority change so no stale pendingCast lingers.
    abandonPendingPayment(state, playerId);

    // Cannot pass priority before confirming attackers
    if (
        state.phase === "DECLARE_ATTACKERS" &&
        state.combat &&
        !state.combat.confirmed
    ) {
        throw new Error("Must declare attackers before passing priority");
    }

    // Cannot pass priority before confirming blockers
    if (
        state.phase === "DECLARE_BLOCKERS" &&
        state.combat &&
        !state.combat.blockersConfirmed
    ) {
        throw new Error("Must declare blockers before passing priority");
    }

    // Cannot pass priority before confirming damage assignments
    if (
        (state.phase === "FIRST_STRIKE_DAMAGE" ||
            state.phase === "COMBAT_DAMAGE") &&
        state.combat &&
        state.combat.damageConfirmed === false
    ) {
        throw new Error("Must assign combat damage before passing priority");
    }

    state.passCount += 1;

    if (state.passCount >= 2 && state.stack.length > 0) {
        // Both players passed consecutively — resolve top of stack (CR 117.3d)
        resolveTopOfStack(state);
        if ((state.pendingChoices?.length ?? 0) > 0) {
            // Resolution suspended awaiting player choices (CR 608.2) — this
            // also covers the reflexive Madness cast-choice (CR 702.35a),
            // which resolveTopOfStack pushes as a blocking pending choice.
            // Hand priority to the chooser; the gate on passPriority and
            // other priority-driven mutations prevents any action other
            // than submitResolutionChoice.
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        } else if (state.pendingTarget) {
            // Resolution requested a copy-retarget (CR 707.10c, Fork).
            // Hand priority to the chooser; only target-selection
            // mutations are legal until they choose or decline.
            state.priorityPlayerId = state.pendingTarget.playerId;
        } else {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        }
    } else if (state.passCount >= 2 && state.stack.length === 0) {
        // Both passed with empty stack → advance phase/step
        advancePhase(state);
    } else {
        // Pass priority to opponent
        state.priorityPlayerId = getOpponentId(state, playerId);
    }

    // If the new priority holder has autoPass, keep draining
    drainAutoPasses(state);

    // Check SBA for game-ending conditions (CR 704.5)
    // CR 704.3 — a resolution suspended on a choice is not a priority
    // window; the sweep waits for the answer.
    sweepUnlessResolutionSuspended(state);

    return { changed: true };
}

/** CR 509.1 — the guards a block CONFIRMATION runs: the game is live, this
 *  player owes the `blockers` input (ADR 0047), the step is DECLARE_BLOCKERS,
 *  the declaration is still open, and the caller is the player who declares
 *  this combat's blocks (Melee, #669). Returns the narrowed, open `combat`. */
function assertBlockConfirmationOpen(
    state: GameState,
    playerId: string
): NonNullable<GameState["combat"]> {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId,
        expect: "blockers",
    });

    if (state.phase !== "DECLARE_BLOCKERS") {
        throw new Error("Not in DECLARE_BLOCKERS phase");
    }
    if (!state.combat || state.combat.blockersConfirmed) {
        throw new Error("Blocker selection is not open");
    }
    // Melee (#669) — the attacker confirms blocks under `blocksDeclaredByAttacker`.
    if (playerId !== getBlockDeclarerId(state)) {
        throw new Error("You can't confirm blockers right now");
    }
    return state.combat;
}

/** Confirm the block declaration as currently assigned (CR 509.1), then give
 *  the active player priority (CR 509.2). */
export function confirmBlockersOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    const combat = assertBlockConfirmationOpen(state, playerId);

    // CR 509.1c: auto-assign must-block requirements (Lure, Blaze of Glory)
    // CR 509.1a/509.1c — `foldBlockRequirements` (`gre/combat.ts`) is the
    // one authority: it adds every must-block assignment the declared-
    // blocker cap leaves room for, gives an already-blocking creature a
    // further attacker for free (the cap counts creatures, not
    // assignments), and — when the cap is full — drops a VOLUNTARY blocker
    // to make room rather than silently skipping the requirement.
    foldBlockRequirements(state);

    // CR 509.1b / 702.111 — minimum-blocker thresholds (menace). A
    // declaration where a menace attacker is blocked by exactly one creature
    // is illegal; this can only be judged once the full block set is known
    // (after must-block auto-assignment above), so it is enforced here at
    // confirm time rather than per-blocker at assignment time.
    const minBlockerCheck = validateMinimumBlockers(state);
    if (!minBlockerCheck.ok) {
        throw new Error(minBlockerCheck.reason);
    }

    // CR 509.1b — count-aware block restrictions (Orcish Conscripts "can't
    // block unless at least two other creatures block"). Judged over the
    // COMPLETE declared-blocker set, so enforced here at confirm.
    const declaredBlockCheck = validateDeclaredBlockers(state);
    if (!declaredBlockCheck.ok) {
        throw new Error(declaredBlockCheck.reason);
    }

    // CR 509.1b — pay-to-block bypass costs (Hipparion "can't block
    // creatures with power 3 or greater unless you pay {1}"). The cost is
    // charged once per qualifying block; the engine auto-taps the blocking
    // player's mana sources (generic-only). If a charge can't be paid, the
    // block declaration is rejected and the player must reassign.
    for (const charge of collectBlockBypassCharges(state)) {
        chargeManaCostOrThrow(
            state,
            charge.controllerId,
            charge.cost,
            charge.reason
        );
    }

    // CR 509.1a — mark each assigned blocker (and re-materialize the
    // condition-bearing statics that read `isBlocking`, e.g. Snow Devil's
    // conditional first strike) BEFORE anything downstream reads
    // `staticAbilities`: `drainAutoPasses` below can run all the way into
    // `advancePhase`'s CR 510.4 first-strike-step skip decision without an
    // intervening SBA pass (issue #1826).
    markDeclaredBlockers(state);

    combat.pendingBlockerId = undefined;
    combat.blockersConfirmed = true;
    recordBlockedAttackers(state);
    // Melee (#669) — untap and remove from combat every attacker that ended
    // up unblocked this combat. No-op unless `blocksDeclaredByAttacker` is set.
    applyMeleeUnblockedRider(state);
    emitBlockersConfirmedEvents(state);

    // CR 509.2 — active player gets priority immediately after blockers
    // are declared. The historic damage-assignment-order turn-based
    // action was removed: per CR 510.1c/d the attacking player divides
    // combat damage freely among multiple blockers during the combat
    // damage step.
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    drainAutoPasses(state);

    return { changed: true };
}

/** Declare NO blockers (CR 509.1a — the defending player may choose that none
 *  of their creatures block): drop every assignment and any half-selected
 *  blocker, then confirm. Requirements still bind — CR 509.1c's must-block
 *  assignments are folded back in by the confirmation, so this yields the
 *  smallest LEGAL declaration, not an illegal empty one. Validates before it
 *  clears, so a refusal leaves the selection as it was. */
export function declareNoBlockersOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    const combat = assertBlockConfirmationOpen(state, playerId);
    combat.blockerAssignments = {};
    combat.pendingBlockerId = undefined;
    return confirmBlockersOnState(state, playerId);
}

/** Decline the attack mana tax. CR 508.1h — the cost to attack is the
 *  declaration's; left unpaid, the declaration cannot be completed and is
 *  reversed (CR 733.1): untap the sources tapped toward it, refund their mana,
 *  and return to attacker selection. */
export function cancelAttackTaxOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId,
        expect: "attack-mana-tax",
    });

    const combat = state.combat;
    const pending = combat?.pendingAttackManaTax;
    if (!combat || !pending || pending.playerId !== playerId) {
        throw new Error("No attack tax to cancel");
    }

    const player = getPlayer(state, playerId);
    for (const cardId of pending.tappedLandIds) {
        const card = player.battlefield.find((c) => c.id === cardId);
        if (card) untapSourceFromPayment(state, player, card);
    }
    combat.pendingAttackManaTax = undefined;
    // Return to attacker selection: drop the declared attackers/bands. The
    // active player still holds priority at DECLARE_ATTACKERS, so they can
    // re-declare (or decline to attack).
    combat.attackerIds = [];
    combat.bands = undefined;
    // CR 508.1g — and the enlist costs chosen for them, or re-selecting the
    // same attacker would pay a cost the new declaration never chose.
    combat.enlists = undefined;

    return { changed: true };
}

/** CR 603.3c/603.3d — resolve a cancel of a `kind:"trigger"` pending target.
 *  A triggered ability chooses its target(s) as it goes on the stack; it is
 *  NOT part of a cast to abort. Cancelling must never leave the trigger on the
 *  stack with `targets: undefined` to resolve doing nothing — an emblem's
 *  "deal 5 damage to any target" would silently deal 0. A MANDATORY target
 *  (min > 0) that the player declines removes the trigger from the stack
 *  entirely (CR 603.3c — no legal target chosen); an "up to" target (min 0)
 *  declines that group: it locks nothing, and the walk moves on (CR 601.2c,
 *  issue #8475) keeping earlier groups' picks. Then chain to any other
 *  still-untargeted trigger of the same batch; otherwise a fresh priority
 *  round begins with the active player. Pure over `GameState` for testability. */
export function cancelTriggerTargetSelection(state: GameState): void {
    const pt = state.pendingTarget;
    if (!pt || pt.kind !== "trigger") return;
    const min = typeof pt.count === "number" ? pt.count : pt.count.min;
    if (min === 0 && (pt.remainingRequirements || pt.priorSelected)) {
        pt.selected = [];
        // The `trigger` half of `advanceTargetGroupOrFinalize` (`game.ts`):
        // a raised finalization loads the next group itself, and only the
        // last group's completion writes the targets (CR 601.2c).
        applyRaisedTargetFinalization(state, pt);
        return;
    }
    if (min > 0) {
        const idx = state.stack.findIndex((s) => s.id === pt.cardInstanceId);
        if (idx !== -1) state.stack.splice(idx, 1);
    } else {
        const trig = state.stack.find((s) => s.id === pt.cardInstanceId);
        if (trig) trig.targets = [];
    }
    state.pendingTarget = undefined;
    // Despite its name this also runs the CR 603.3c MODE announcement for any
    // still-un-announced modal trigger left on the stack (issue #2461).
    if (!raiseTriggerTargetSelection(state)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
    }
}

/** Cancel the pending target selection `playerId` owes. A TRIGGER's target
 *  is declined (CR 603.3c/603.3d, `cancelTriggerTargetSelection`); a declined
 *  copy-retarget or retarget leaves the spell with its current targets and
 *  opens a fresh priority round (CR 707.10c / 115.7); an ANNOUNCED cast's or
 *  activation's target selection is aborted (CR 601.2 / 602.2 — nothing was
 *  paid yet, so clearing the selection rewinds the announcement). */
export function cancelTargetOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId,
        expect: "target",
    });

    if (!state.pendingTarget)
        throw new Error("No target selection in progress");
    if (state.pendingTarget.playerId !== playerId) {
        throw new Error("Not your pending target selection");
    }

    const cancelKind = state.pendingTarget.kind;

    // CR 603.3c/603.3d — a triggered ability chooses its target(s) as it
    // goes on the stack; a triggered target is NOT part of a cast to abort.
    if (cancelKind === "trigger") {
        cancelTriggerTargetSelection(state);
        return { changed: true };
    }

    // CR 707.10c / 115.7 — declining a copy-retarget OR an original-spell
    // retarget (Reflecting Mirror) is not aborting a cast: the targeted
    // spell stays on the stack with its current targets and a fresh
    // priority round begins (the copying / retargeting effect has already
    // resolved).
    const wasRetarget =
        cancelKind === "copy-retarget" || cancelKind === "retarget";
    clearDeclinedExileRoute(state, state.pendingTarget.cardInstanceId);
    state.pendingTarget = undefined;
    if (wasRetarget) continueAfterRetargetOffer(state);

    return { changed: true };
}

/** Rewind a spell announcement whose payment is open (CR 601.2 — a cast
 *  that never completed leaves no trace): reverse every payment tap and
 *  clear `pendingCast` (`rollbackPendingCast`). */
export function cancelCastOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId,
        expect: "priority",
    });

    if (!state.pendingCast) throw new Error("No spell being cast");
    if (state.pendingCast.playerId !== playerId) {
        throw new Error("Not your pending cast");
    }

    rollbackPendingCast(state);

    return { changed: true };
}

/** Rewind an activated-ability announcement whose payment is open (CR 602.2):
 *  reverse every payment tap and clear `pendingActivation`. The source
 *  permanent is untouched because tap/sacrifice costs are deferred until
 *  commit. */
export function cancelActivationOnState(
    state: GameState,
    playerId: string
): DeclineOutcome {
    assertGameNotOver(state);
    assertExpectedInput(state, {
        playerId,
        expect: "priority",
        // CR 608.2g / 605.3a (issue #3455) — a mana ability's park is
        // cancellable wherever it is openable, the may-pay window included.
        allowManaForMayPay: isInlineManaAbilityPark(state, playerId),
    });

    const pa = state.pendingActivation;
    if (!pa) throw new Error("No ability being activated");
    if (pa.playerId !== playerId) {
        throw new Error("Not your pending activation");
    }

    rollbackPendingActivation(state);

    return { changed: true };
}
