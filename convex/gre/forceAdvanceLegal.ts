// The LEGAL rungs of the Bot liveness ladder (ADR 0178):
// for every Expected Input kind, the one CR-defined answer or decline the
// engine can apply with no Convex context. `forceAdvanceOwedInput`
// (`forceAdvance.ts`) tries this first and falls back to the forced discard
// (`forceAdvanceDiscard.ts`) only when it throws, changes nothing, or leaves
// the Bot owed on the same container.
//
// Every step reuses the auth-free core the public mutation runs (the decline
// cores, the attack and damage confirmations, the pending-choice resolvers,
// the sacrifice pick) — never a second copy of a rule. Each step mutates
// `state` IN PLACE and either throws or returns the name of the action it took;
// the caller runs it on a clone.

import { declareNoAttackersOnState } from "./attackDeclaration";
import { confirmDefaultDamageOnState } from "./damageConfirmation";
import type { ExpectedInputKind } from "./expectedInput";
import { legalActions, type ChoiceAction } from "./legalActions";
import { declineMadness } from "./madness";
import { recordDeclaration } from "./mulligan";
import {
    cancelAttackTaxOnState,
    cancelTargetOnState,
    declareNoBlockersOnState,
    passPriorityOnState,
    type DeclineOutcome,
} from "./owedInputDeclines";
import {
    applyLandEntrySubmit,
    applyMayPaySubmit,
    applyMiracleRevealSubmit,
    applyNumberChoiceSubmit,
    applyPendingChoiceSubmit,
    applyRandomRevealAck,
} from "./pendingChoiceSubmit";
import { sweepUnlessResolutionSuspended } from "./pendingChoiceResume";
import { drainAutoPasses } from "./phases";
import { declineRebound } from "./rebound";
import { selectSacrificeOnState } from "./sacrificePick";
import { checkStateBasedActions } from "./sba";
import type { GameState } from "./state";

/** One legal rung: apply the answer to `state` in place and return the action
 *  taken, or throw when there is no legal answer to give. */
export type LegalStep = (state: GameState, botPlayerId: string) => string;

/** A decline core that changed nothing is not progress: the ladder treats it
 *  exactly like a throw and moves on to the forced discard. */
function requireProgress(outcome: DeclineOutcome, action: string): string {
    if (!outcome.changed) {
        throw new Error(`${action} changed nothing (${outcome.reason})`);
    }
    return action;
}

/** True when `botPlayerId` assigns a combat damage source it has not yet
 *  confirmed (CR 510.1c-d; CR 702.22j-k banding can make that the defending
 *  player, who does not hold priority in the window). */
function owesDamageAssignment(state: GameState, botPlayerId: string): boolean {
    const combat = state.combat;
    if (
        (state.phase !== "FIRST_STRIKE_DAMAGE" &&
            state.phase !== "COMBAT_DAMAGE") ||
        !combat ||
        combat.damageConfirmed !== false
    ) {
        return false;
    }
    const confirmed = new Set(combat.damageAssignmentConfirmedBy ?? []);
    return Object.values(combat.damageAssignerIds ?? {}).some(
        (id) => id === botPlayerId && !confirmed.has(id)
    );
}

/** `priority` — CR 117.3d: pass. Three turn-based declarations ride the same
 *  priority window and have no pass; each gets its minimal LEGAL answer: the
 *  pre-game declaration (CR 103.5) keeps, an open attack declaration declares
 *  no voluntary attacker (CR 508.1a, CR 508.1d's requirements folded in), an
 *  outstanding damage assignment confirms the default (CR 510.1c-d). A parked
 *  payment is abandoned by the pass itself (`passPriorityOnState`). */
function priorityStep(state: GameState, botPlayerId: string): string {
    const mulligan = state.mulligan;
    if (
        state.phase === "MULLIGAN" &&
        mulligan &&
        !mulligan.bottoming &&
        mulligan.declaringPlayerId === botPlayerId
    ) {
        recordDeclaration(state, botPlayerId, "keep");
        return "keep-hand";
    }
    if (
        state.phase === "DECLARE_ATTACKERS" &&
        state.combat &&
        !state.combat.confirmed &&
        state.activePlayerId === botPlayerId
    ) {
        return requireProgress(
            declareNoAttackersOnState(state, botPlayerId),
            "declare-no-attackers"
        );
    }
    if (owesDamageAssignment(state, botPlayerId)) {
        return requireProgress(
            confirmDefaultDamageOnState(state, botPlayerId),
            "confirm-damage"
        );
    }
    return requireProgress(passPriorityOnState(state, botPlayerId), "pass");
}

/** `blockers` — CR 509.1a: the defending player may block with no creature.
 *  The core folds CR 509.1c's requirements back in, so this is the smallest
 *  LEGAL declaration. */
function blockersStep(state: GameState, botPlayerId: string): string {
    return requireProgress(
        declareNoBlockersOnState(state, botPlayerId),
        "declare-no-blockers"
    );
}

/** `attack-mana-tax` — CR 508.1h: an unpaid cost to attack reverses the
 *  declaration, back to attacker selection. */
function attackManaTaxStep(state: GameState, botPlayerId: string): string {
    return requireProgress(
        cancelAttackTaxOnState(state, botPlayerId),
        "cancel-attack-tax"
    );
}

/** `target` — CR 603.3d / 601.2: decline the raised target, or rewind the
 *  announcement whose selection it is. */
function targetStep(state: GameState, botPlayerId: string): string {
    return requireProgress(
        cancelTargetOnState(state, botPlayerId),
        "cancel-target"
    );
}

/** `sacrifice` — CR 701.21a / 508.1h: the parked attack-sacrifice tax has no
 *  decline, so the minimal answer is the first legal victim, picked one at a
 *  time until the selection completes (the core then finalizes the attack).
 *  Bounded by the candidate count the engine offers on each pick. */
function sacrificeStep(state: GameState, botPlayerId: string): string {
    const picked: string[] = [];
    for (;;) {
        const owed = state.combat?.pendingAttackSacrifice;
        if (!owed || owed.playerId !== botPlayerId) break;
        const next = legalActions(state).find(
            (a) => a.expect === "sacrifice" && a.playerId === botPlayerId
        );
        if (!next || next.expect !== "sacrifice") {
            throw new Error("No legal sacrifice candidate");
        }
        const cardInstanceId = next.action.cardInstanceId;
        if (picked.includes(cardInstanceId)) {
            throw new Error(`Sacrifice pick repeated: ${cardInstanceId}`);
        }
        selectSacrificeOnState(state, {
            playerId: botPlayerId,
            cardInstanceId,
        });
        picked.push(cardInstanceId);
    }
    if (picked.length === 0) throw new Error("No sacrifice owed");
    return `select-sacrifice:${picked.length}`;
}

/** How conservative a choice answer is — lower is preferred. Every decline the
 *  rules offer (do not pay, enter tapped, keep the miracle hidden, decline the
 *  reflexive cast, nominate the floor) ranks first; a zone pick ranks by how
 *  few cards it moves. `null` = no auth-free answer exists for that action
 *  (`submit-name-card` carries an open payload the caller must fill). */
function choiceAnswerRank(action: ChoiceAction): number | null {
    switch (action.kind) {
        case "submit-random-reveal-ack":
        case "submit-madness-decline":
        case "submit-rebound-decline":
        case "submit-number-choice":
            return 0;
        case "submit-may-pay":
        case "submit-land-entry":
            return action.accept ? 100 : 0;
        case "submit-miracle-reveal":
            return action.reveal ? 100 : 0;
        case "submit-choice":
            return 1 + action.cardInstanceIds.length;
        case "submit-name-card":
            return null;
        default:
            return assertNeverChoiceAction(action);
    }
}

/** Apply one choice answer through the resolver its mutation drives, with the
 *  mutation's own epilogue (`submitResolutionChoice`'s CR 704.3 sweep, the
 *  CR 117.3b priority reset of the two reflexive-cast declines). */
function applyChoiceAnswer(
    state: GameState,
    playerId: string,
    action: ChoiceAction
): string {
    switch (action.kind) {
        case "submit-choice":
            applyPendingChoiceSubmit(state, {
                playerId,
                stackItemId: action.stackItemId,
                step: action.step,
                choiceId: action.choiceId,
                cardInstanceIds: action.cardInstanceIds,
            });
            sweepUnlessResolutionSuspended(state);
            return `choice:${action.cardInstanceIds.length}`;
        case "submit-may-pay":
            applyMayPaySubmit(state, { playerId, accept: action.accept });
            return action.accept ? "may-pay:accept" : "may-pay:decline";
        case "submit-land-entry":
            applyLandEntrySubmit(state, { playerId, accept: action.accept });
            return action.accept ? "land-entry:pay" : "land-entry:tapped";
        case "submit-miracle-reveal":
            applyMiracleRevealSubmit(state, {
                playerId,
                reveal: action.reveal,
            });
            return action.reveal ? "miracle:reveal" : "miracle:hide";
        case "submit-number-choice":
            applyNumberChoiceSubmit(state, { playerId, amount: action.min });
            return `number:${action.min}`;
        case "submit-random-reveal-ack":
            applyRandomRevealAck(state, {
                playerId,
                stackItemId: action.stackItemId,
                choiceId: action.choiceId,
            });
            return "random-reveal-ack";
        case "submit-madness-decline":
        case "submit-rebound-decline":
            if (action.kind === "submit-madness-decline") declineMadness(state);
            else declineRebound(state);
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
            checkStateBasedActions(state);
            return action.kind === "submit-madness-decline"
                ? "madness:decline"
                : "rebound:decline";
        case "submit-name-card":
            throw new Error("A name-card choice has no auth-free answer");
        default:
            return assertNeverChoiceAction(action);
    }
}

/** `choice` — CR 608.2: the head choice's most conservative LEGAL answer, out
 *  of the engine's own enumeration (`legalActions`, ADR 0047 — the same set
 *  the gate admits). */
function choiceStep(state: GameState, botPlayerId: string): string {
    let best: { action: ChoiceAction; rank: number } | undefined;
    for (const legal of legalActions(state)) {
        if (legal.expect !== "choice" || legal.playerId !== botPlayerId) {
            continue;
        }
        const rank = choiceAnswerRank(legal.action);
        if (rank === null) continue;
        if (!best || rank < best.rank) best = { action: legal.action, rank };
    }
    if (!best) throw new Error("No auth-free legal answer to the choice");
    return applyChoiceAnswer(state, botPlayerId, best.action);
}

/** The legal rung per Expected Input kind. A `Record` over the union, so a
 *  new kind is a build error until it has an entry. */
export const LEGAL_STEPS: Record<ExpectedInputKind, LegalStep> = {
    priority: priorityStep,
    blockers: blockersStep,
    "attack-mana-tax": attackManaTaxStep,
    target: targetStep,
    choice: choiceStep,
    sacrifice: sacrificeStep,
};

function assertNeverChoiceAction(x: never): never {
    throw new Error(`Unhandled choice action: ${JSON.stringify(x)}`);
}
