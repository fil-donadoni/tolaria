// The FORCED DISCARD — the terminal rung of the Bot liveness ladder (issue
// #9002, PRD issue #8998, ADR 0176). When every legal rung for the window the
// Bot owes has thrown, changed nothing, or left it owed on the same container,
// the owed container is removed as if it had never been opened, and the stack
// item whose resolution raised it leaves the stack as if it had fizzled.
//
// This is an EXPLICIT CR DEVIATION, owner-ruled 2026-11-09: a forced discard
// ignores what the rules would still require (CR 508.1d / 509.1c requirements,
// a mandatory choice's answer, an attack cost). It is acceptable only because
// every one is recorded `discarded: true` and reported as a P0 bug. It runs
// only after the legal rungs (`forceAdvanceLegal.ts`), never in their place.
//
// Each discard mutates `state` IN PLACE and either throws (nothing it can
// discard — the caller concedes) or returns the name of what it removed.

import { finalizeConfirmAttackers } from "./attackDeclaration";
import { recordBlockedAttackers } from "./banding";
import { resolvePendingTargetKind } from "./constants";
import type { ExpectedInputKind } from "./expectedInput";
import {
    rollbackPendingActivation,
    rollbackPendingCast,
} from "./paymentRollback";
import {
    handPriorityOn,
    sweepUnlessResolutionSuspended,
} from "./pendingChoiceResume";
import { drainAutoPasses, emitBlockersConfirmedEvents } from "./phases";
import { sendStackItemToGraveyard, type GameState } from "./state";

/** One discard rung: remove the owed container in place, return its name. */
export type DiscardStep = (state: GameState, botPlayerId: string) => string;

/** Take `itemId` off the stack the way CR 608.2b takes off a spell or ability
 *  whose targets are all illegal: a spell card goes to its owner's graveyard
 *  (through the one chokepoint, so CR 614 redirects still apply), a copy or an
 *  ability ceases to exist. Its effect never happens. A missing item is fine —
 *  some choices are raised by no stack item. */
function removeStackItemAsFizzled(state: GameState, itemId: string): void {
    const idx = state.stack.findIndex((s) => s.id === itemId);
    if (idx === -1) return;
    const [item] = state.stack.splice(idx, 1);
    delete item.collectedChoices;
    sendStackItemToGraveyard(state, item);
}

/** Drop a parked announcement: the legal rewind first (CR 601.2 — reverse
 *  every payment tap), and when even that throws, the bare field. */
function dropAnnouncement(
    state: GameState,
    container: "cast" | "activation"
): void {
    try {
        if (container === "cast") rollbackPendingCast(state);
        else rollbackPendingActivation(state);
    } catch {
        if (container === "cast") state.pendingCast = undefined;
        else state.pendingActivation = undefined;
    }
}

/** A fresh priority round for the active player (CR 117.3b's shape) — where
 *  the game stands once the discarded window is gone. */
function restartPriority(state: GameState): void {
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    drainAutoPasses(state);
}

/** Abandon the attack declaration in progress: no creature attacks, whatever
 *  CR 508.1d would require, and the declaration closes so the combat moves on
 *  (`finalizeConfirmAttackers` with an empty attacker set). */
function abandonAttackDeclaration(state: GameState): void {
    const combat = state.combat;
    if (!combat) throw new Error("No attack declaration to abandon");
    combat.pendingAttackSacrifice = undefined;
    combat.pendingAttackManaTax = undefined;
    combat.attackerIds = [];
    combat.attackTargets = undefined;
    combat.bands = undefined;
    combat.enlists = undefined;
    combat.exertedIds = undefined;
    finalizeConfirmAttackers(state);
}

/** `choice` — drop every queued choice the head's stack item raised, take that
 *  item off the stack as fizzled, and hand priority on as a completed
 *  resolution would. */
function discardChoice(state: GameState): string {
    const head = state.pendingChoices?.[0];
    if (!head) throw new Error("No pending choice to discard");
    const rest = (state.pendingChoices ?? []).filter(
        (c) => c.stackItemId !== head.stackItemId
    );
    state.pendingChoices = rest.length > 0 ? rest : undefined;
    removeStackItemAsFizzled(state, head.stackItemId);
    handPriorityOn(state, true);
    sweepUnlessResolutionSuspended(state);
    return `discard-choice:${head.kind}`;
}

/** `target` — drop the selection. A raised trigger or copy leaves the stack as
 *  fizzled; a retargeted spell keeps the targets it has; an announcement whose
 *  selection it was is dropped with it. */
function discardTarget(state: GameState, botPlayerId: string): string {
    const pt = state.pendingTarget;
    if (!pt) throw new Error("No pending target to discard");
    state.pendingTarget = undefined;
    const kind = resolvePendingTargetKind(pt.kind);
    switch (kind) {
        case "trigger":
        case "copy-retarget":
            removeStackItemAsFizzled(state, pt.cardInstanceId);
            break;
        case "retarget":
            break;
        case "cast":
            if (state.pendingCast?.playerId === botPlayerId) {
                dropAnnouncement(state, "cast");
            }
            break;
        case "ability":
            if (state.pendingActivation?.playerId === botPlayerId) {
                dropAnnouncement(state, "activation");
            }
            break;
        default:
            return assertNever(kind);
    }
    restartPriority(state);
    return `discard-target:${kind}`;
}

/** `blockers` — close the declaration with no blocker, whatever CR 509.1c
 *  requires, and give the active player priority (CR 509.2's shape). */
function discardBlockers(state: GameState): string {
    const combat = state.combat;
    if (!combat || combat.blockersConfirmed) {
        throw new Error("No block declaration to discard");
    }
    combat.blockerAssignments = {};
    combat.pendingBlockerId = undefined;
    combat.blockersConfirmed = true;
    recordBlockedAttackers(state);
    emitBlockersConfirmedEvents(state);
    restartPriority(state);
    return "discard-blockers";
}

/** `sacrifice` / `attack-mana-tax` — the cost to attack is never paid and the
 *  attack it was a cost of is abandoned with it. */
function discardAttackCost(state: GameState): string {
    const combat = state.combat;
    if (!combat?.pendingAttackSacrifice && !combat?.pendingAttackManaTax) {
        throw new Error("No attack cost to discard");
    }
    abandonAttackDeclaration(state);
    return "discard-attack-cost";
}

/** `priority` — the window itself cannot be discarded; what can is whatever
 *  the Bot parked inside it: a half-paid announcement, a companion payment, an
 *  open attack declaration. Nothing parked (a mulligan declaration, a combat
 *  damage assignment) → throws, and the caller concedes. */
function discardPriority(state: GameState, botPlayerId: string): string {
    const dropped: string[] = [];
    if (state.pendingCast?.playerId === botPlayerId) {
        dropAnnouncement(state, "cast");
        dropped.push("cast");
    }
    if (state.pendingActivation?.playerId === botPlayerId) {
        dropAnnouncement(state, "activation");
        dropped.push("activation");
    }
    if (state.pendingCompanionPay?.playerId === botPlayerId) {
        state.pendingCompanionPay = undefined;
        dropped.push("companion");
    }
    if (
        state.phase === "DECLARE_ATTACKERS" &&
        state.combat &&
        !state.combat.confirmed &&
        state.activePlayerId === botPlayerId
    ) {
        abandonAttackDeclaration(state);
        dropped.push("attack-declaration");
    }
    if (dropped.length === 0) {
        throw new Error("Nothing the Bot parked in this priority window");
    }
    return `discard-priority:${dropped.join("+")}`;
}

/** The forced discard for the Expected Input kind the Bot owes. */
export function forcedDiscard(
    kind: ExpectedInputKind,
    state: GameState,
    botPlayerId: string
): string {
    switch (kind) {
        case "choice":
            return discardChoice(state);
        case "target":
            return discardTarget(state, botPlayerId);
        case "blockers":
            return discardBlockers(state);
        case "sacrifice":
        case "attack-mana-tax":
            return discardAttackCost(state);
        case "priority":
            return discardPriority(state, botPlayerId);
        default:
            return assertNever(kind);
    }
}

function assertNever(x: never): never {
    throw new Error(`Unhandled forced-discard kind: ${String(x)}`);
}
