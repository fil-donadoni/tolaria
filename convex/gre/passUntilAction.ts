/**
 * Pass Until Action (issue #5782) — the soft rest-of-turn pass.
 *
 * A standing intent beside Pass Turn: `drainAutoPasses` passes for the seat
 * exactly as it does for an `autoPassPlayers` entry, but the moment priority
 * reaches the seat while a NEW opponent-controlled object sits on the stack
 * the drain stops there, the seat holds priority with a real response window,
 * and the intent is consumed.
 *
 * "Opponent-controlled" is the stack object's controller (`castById`), which
 * for a triggered ability is the controller of its source (CR 113.8) — so an
 * opponent's trigger that fired off this seat's own action stops the pass,
 * and a trigger this seat controls never does. A mana ability never reaches
 * the stack (CR 605.3b), so it cannot stop it. Objects already on the stack
 * when the intent was armed are recorded in `ignoredStackIds` and never stop
 * it: the press means "I am fine with what is there".
 *
 * A stack item's `id` is NOT unique per stack object: an activated ability
 * keeps its source's id and a spell its card's id, so the same id can come
 * back as a NEW object (a second activation of one source, an ability of the
 * permanent a baseline spell became, a recast). The baseline is therefore a
 * MULTISET matched from the BOTTOM of the stack — objects put on the stack
 * later always sit above the ones that were there — and it is pruned to the
 * baseline objects still present every time the drain looks at it, so an id
 * that left the stack never shields its successor.
 *
 * Pure state helpers: the `passUntilAction` mutation (`convex/game.ts`) and
 * `drainAutoPasses` (`gre/phases.ts`) are the only callers besides tests.
 */
import type { GameState, PassUntilActionIntent } from "./state";

function intentFor(
    list: PassUntilActionIntent[] | undefined,
    playerId: string
): PassUntilActionIntent | undefined {
    return list?.find((i) => i.playerId === playerId);
}

function without(
    list: PassUntilActionIntent[] | undefined,
    playerId: string
): PassUntilActionIntent[] | undefined {
    const remaining = (list ?? []).filter((i) => i.playerId !== playerId);
    return remaining.length > 0 ? remaining : undefined;
}

function newIntent(state: GameState, playerId: string): PassUntilActionIntent {
    return {
        playerId,
        ignoredStackIds: state.stack.map((item) => item.id),
    };
}

/** True while `playerId` holds an ARMED intent (the drain passes for them). */
export function isPassingUntilAction(
    state: GameState,
    playerId: string
): boolean {
    return intentFor(state.passUntilAction, playerId) !== undefined;
}

/** Arm the intent for a seat that holds priority. Re-arming refreshes the
 *  baseline to the current stack. */
export function armPassUntilAction(state: GameState, playerId: string): void {
    state.passUntilAction = [
        ...(without(state.passUntilAction, playerId) ?? []),
        newIntent(state, playerId),
    ];
}

/** Record the intent for a seat WITHOUT priority. The baseline is the stack
 *  at press time, not at promotion: the object the opponent is putting on the
 *  stack while this seat waits is exactly what the press asks to stop on. */
export function queuePassUntilAction(state: GameState, playerId: string): void {
    state.queuedPassUntilAction = [
        ...(without(state.queuedPassUntilAction, playerId) ?? []),
        newIntent(state, playerId),
    ];
}

/** Promote a queued intent into an armed one, keeping its press-time
 *  baseline. No-op when nothing is queued for the seat. */
export function promoteQueuedPassUntilAction(
    state: GameState,
    playerId: string
): void {
    const queued = intentFor(state.queuedPassUntilAction, playerId);
    if (!queued) return;
    state.queuedPassUntilAction = without(
        state.queuedPassUntilAction,
        playerId
    );
    state.passUntilAction = [
        ...(without(state.passUntilAction, playerId) ?? []),
        queued,
    ];
}

/** Drop both the armed and the queued intent. Returns whether either existed. */
export function clearPassUntilAction(
    state: GameState,
    playerId: string
): boolean {
    const had =
        intentFor(state.passUntilAction, playerId) !== undefined ||
        intentFor(state.queuedPassUntilAction, playerId) !== undefined;
    state.passUntilAction = without(state.passUntilAction, playerId);
    state.queuedPassUntilAction = without(
        state.queuedPassUntilAction,
        playerId
    );
    return had;
}

/** Per stack index (bottom first): true when the object is one of the
 *  baseline's — the bottom-most occurrences of each baseline id, as many as
 *  the baseline holds. */
function baselineMask(
    state: GameState,
    intent: PassUntilActionIntent
): boolean[] {
    const remaining = new Map<string, number>();
    for (const id of intent.ignoredStackIds) {
        remaining.set(id, (remaining.get(id) ?? 0) + 1);
    }
    return state.stack.map((item) => {
        const n = remaining.get(item.id) ?? 0;
        if (n === 0) return false;
        remaining.set(item.id, n - 1);
        return true;
    });
}

function pruned(
    state: GameState,
    list: PassUntilActionIntent[] | undefined
): PassUntilActionIntent[] | undefined {
    return list?.map((intent) => {
        const mask = baselineMask(state, intent);
        return {
            playerId: intent.playerId,
            ignoredStackIds: state.stack
                .filter((_, i) => mask[i])
                .map((item) => item.id),
        };
    });
}

/** Shrink every baseline (armed and queued) to the baseline objects still on
 *  the stack. Called by `drainAutoPasses` on every iteration, so a baseline
 *  object that resolved or left can never shield a new object that reuses its
 *  id. */
export function prunePassUntilActionBaselines(state: GameState): void {
    if (state.passUntilAction) {
        state.passUntilAction = pruned(state, state.passUntilAction);
    }
    if (state.queuedPassUntilAction) {
        state.queuedPassUntilAction = pruned(
            state,
            state.queuedPassUntilAction
        );
    }
}

/** The stop condition, read when priority reaches `playerId`: an armed intent
 *  AND a stack object controlled by someone else that was not on the stack
 *  when the intent was armed. On a stop the armed intent is CONSUMED — the
 *  seat is back to manual priority for the rest of the turn. */
export function consumePassUntilActionStop(
    state: GameState,
    playerId: string
): boolean {
    const intent = intentFor(state.passUntilAction, playerId);
    if (!intent) return false;
    const mask = baselineMask(state, intent);
    const stops = state.stack.some(
        (item, i) => item.castById !== playerId && !mask[i]
    );
    if (stops) {
        state.passUntilAction = without(state.passUntilAction, playerId);
    }
    return stops;
}
