// Dominated trigger-target answers (issue #6334) — the mover's own model at a
// trigger-target node, the twin of the dominated multi-blocks of issue #5951
// (`blockDominance.ts`).
//
// A triggered ability announces its targets as it is put on the stack (CR
// 603.3d), and a mandatory one may have to name its own controller's
// permanents: a Flametongue Kavu returned by a delayed trigger "deals 4 damage
// to target creature", and the Kavu itself is a legal target. ISMCTS EXPLORES
// every answer at that node, and its mean backup debits the line that led
// there with each of the mover's own mistakes. Below the root the reward band
// is a few hundredths wide, so UCB1 cannot steer away from the self-shot and
// the line reads two-thirds as bad as it is: the flicker of the bot's own
// Kavu lost to an exile of the opposing Hill Giant that only lasts a turn.
//
// An answer B is DOMINATED when another answer A leaves the mover at least as
// well off on every observable axis once the trigger has resolved — every
// permanent the mover controls after B is still there after A, no permanent
// the opponent controls after A was gone after B, no life, poison or hand
// count moves against the mover, both libraries are the same size, and every
// common survivor carries the same counters — and strictly better on one of
// them. Strictness keeps both of two answers the axes cannot tell apart (a
// pump, a tap), so no answer is ever pruned for what it does off the axes.
// The maximal answers always survive: dropping B never removes the mover's
// best answer.
//
// The verdict is SIMULATED through the real engine, never derived: each answer
// is applied to a clone and resolved, with the state-based actions after it
// (CR 704.3). It fails CLOSED to "keep": an answer that leaves anything behind
// — another trigger, a choice, a further announcement, a delayed trigger
// whose payoff lands after the probe (the blink's return) — is never judged, and
// neither is a node whose trigger has anything underneath it (an answer there
// is priced against an announcement the mover did not make).
//
// Tree only (`withoutDominatedTriggerTargets`, `search.ts`), like the block
// prune and for the same reason: the defect is the node's mean backup over the
// answers it explores, and the rollout already reads each answer settled
// (`policyProbeState`). Bot paths only: a dominated answer is LEGAL, and the
// human affordance surface keeps the whole set.

import type { GameState } from "../state";
import { getOpponentId, resolveTopOfStack } from "../state";
import type { Move } from "../moves";
import { cloneGameState } from "../clone";
import { checkStateBasedActions } from "../sba";

/** What one answer leaves behind once its trigger has resolved. */
type TriggerOutcome = {
    moverPermanents: Map<string, string>;
    opponentPermanents: Map<string, string>;
    moverLife: number;
    opponentLife: number;
    moverPoison: number;
    opponentPoison: number;
    moverHand: number;
    opponentHand: number;
    libraries: string;
};

/** Each permanent `playerId` controls, keyed by id, valued by its counters. */
function controlledPermanents(
    state: GameState,
    playerId: string
): Map<string, string> {
    const out = new Map<string, string>();
    for (const player of state.players) {
        for (const card of player.battlefield) {
            if (card.controllerId !== playerId) continue;
            out.set(card.id, JSON.stringify(card.counters ?? {}));
        }
    }
    return out;
}

function resolveAnswer(
    state: GameState,
    moverId: string,
    opponentId: string,
    move: Move,
    apply: (probe: GameState, move: Move) => void
): TriggerOutcome | undefined {
    const probe = cloneGameState(state);
    const scheduled = state.delayedTriggers?.length ?? 0;
    try {
        apply(probe, move);
        if (probe.stack.length !== 1 || probe.pendingTarget) return undefined;
        if ((probe.pendingChoices?.length ?? 0) > 0) return undefined;
        resolveTopOfStack(probe);
        if ((probe.pendingChoices?.length ?? 0) > 0) return undefined;
        if (probe.pendingTarget) return undefined;
        checkStateBasedActions(probe);
    } catch {
        return undefined;
    }
    // A resolution that SCHEDULES something (CR 603.7a — "return that card
    // at the beginning of the next end step") has its payoff after this
    // probe stops: the flickered permanent reads as lost.
    if (
        probe.stack.length > 0 ||
        probe.pendingTarget ||
        (probe.pendingChoices?.length ?? 0) > 0 ||
        (probe.delayedTriggers?.length ?? 0) !== scheduled
    ) {
        return undefined;
    }
    const mover = probe.players.find((p) => p.id === moverId);
    const opponent = probe.players.find((p) => p.id === opponentId);
    if (!mover || !opponent) return undefined;
    return {
        moverPermanents: controlledPermanents(probe, moverId),
        opponentPermanents: controlledPermanents(probe, opponentId),
        moverLife: mover.life,
        opponentLife: opponent.life,
        moverPoison: mover.poisonCounters ?? 0,
        opponentPoison: opponent.poisonCounters ?? 0,
        moverHand: mover.hand.length,
        opponentHand: opponent.hand.length,
        libraries: `${mover.library.length}/${opponent.library.length}`,
    };
}

/** -1: `a` is worse than `b` on this axis, 0: equal, 1: better. */
type AxisOrder = -1 | 0 | 1;

/** `sub ⊆ sup`, every common member carrying the same counters: 1 when the
 *  inclusion is strict, 0 when equal, `undefined` when it does not hold. */
function inclusion(
    sub: Map<string, string>,
    sup: Map<string, string>
): 0 | 1 | undefined {
    for (const [id, counters] of sub) {
        if (sup.get(id) !== counters) return undefined;
    }
    return sup.size > sub.size ? 1 : 0;
}

function sign(n: number): AxisOrder {
    return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Whether answer `a` leaves the mover strictly better off than `b`. */
function strictlyDominates(a: TriggerOutcome, b: TriggerOutcome): boolean {
    if (a.libraries !== b.libraries) return false;
    const moverKept = inclusion(b.moverPermanents, a.moverPermanents);
    const opponentLost = inclusion(a.opponentPermanents, b.opponentPermanents);
    if (moverKept === undefined || opponentLost === undefined) return false;
    const axes: AxisOrder[] = [
        moverKept,
        opponentLost,
        sign(a.moverLife - b.moverLife),
        sign(b.opponentLife - a.opponentLife),
        sign(b.moverPoison - a.moverPoison),
        sign(a.opponentPoison - b.opponentPoison),
        sign(a.moverHand - b.moverHand),
        sign(b.opponentHand - a.opponentHand),
    ];
    return !axes.includes(-1) && axes.includes(1);
}

/** `moves` without the trigger-target answers another answer strictly
 *  dominates. Unchanged unless `state` is a trigger's target announcement
 *  (CR 603.3d) owned by `moverId` with that trigger alone on the stack. */
export function pruneDominatedTriggerTargets(
    state: GameState,
    moverId: string,
    moves: readonly Move[],
    apply: (probe: GameState, move: Move) => void
): Move[] {
    const announcing = state.pendingTarget;
    if (
        !announcing ||
        announcing.kind !== "trigger" ||
        announcing.playerId !== moverId ||
        state.stack.length !== 1
    ) {
        return [...moves];
    }
    const opponentId = getOpponentId(state, moverId);
    const answers = moves.filter((m) => m.kind === "submit-target");
    if (answers.length < 2) return [...moves];
    const outcomes = new Map<Move, TriggerOutcome>();
    for (const move of answers) {
        const outcome = resolveAnswer(state, moverId, opponentId, move, apply);
        if (outcome) outcomes.set(move, outcome);
    }
    return moves.filter((b) => {
        const ob = outcomes.get(b);
        if (!ob) return true;
        for (const [a, oa] of outcomes) {
            if (a !== b && strictlyDominates(oa, ob)) return false;
        }
        return true;
    });
}
