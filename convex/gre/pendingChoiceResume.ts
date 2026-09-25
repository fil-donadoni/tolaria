// The shared tail of every Pending Choice answer (CR 608.2, issue #4443):
// commit the answer onto the stack item, drop the answered head, and — once
// the queue is empty — resume the suspended resolution and hand priority on.
// Each submit handler used to carry its own copy of this sequence; they now
// return into the one below.

import { resolveTopOfStack, type GameState, type PendingChoice } from "./state";
import { drainAutoPasses } from "./phases";
import { checkStateBasedActions } from "./sba";

/** Mid-resolution choice (CR 608.2): write `answer` into the stack item's
 *  `collectedChoices` under the choice's `step:choiceId` key, so the next
 *  invocation of the resolve step reads it back. `extra` carries sibling keys
 *  (`order-top` / `look-distribute`'s second list). Throws when the head's
 *  stack item is gone. */
export function commitChoiceAnswer(
    state: GameState,
    head: PendingChoice,
    answer: string[],
    extra: Record<string, string[]> = {}
): void {
    const stackItem = state.stack.find((s) => s.id === head.stackItemId);
    if (!stackItem) throw new Error("Stack item not found");
    const key = `${head.step}:${head.choiceId}`;
    stackItem.collectedChoices = {
        ...(stackItem.collectedChoices ?? {}),
        [key]: answer,
        ...extra,
    };
}

/** Drop the answered head; an emptied queue is stored as `undefined`. */
export function dequeueHead(state: GameState, queue: PendingChoice[]): void {
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;
}

/** The two steps of the epilogue that differ between the families that
 *  return into it. Both are kept per family exactly as each shipped — the
 *  registry changed the dispatch, never what a kind does on resume. */
export type ResumeOptions = {
    /** Hand priority to a `pendingTarget` the resumed resolution raised (a
     *  copy-retarget) rather than to the active player. */
    pendingTargetHandoff: boolean;
    /** Sweep state-based actions after the resumed resolution. */
    stateBasedActions: boolean;
};

/** Priority after a choice window closes with no further choice owed: to the
 *  next queued chooser, else (optionally) to the pending target's chooser,
 *  else back to the active player with the pass count reset (CR 117.3b). */
export function handPriorityOn(
    state: GameState,
    pendingTargetHandoff: boolean
): void {
    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
    } else if (pendingTargetHandoff && state.pendingTarget) {
        // Resolution requested a copy-retarget (CR 707.10b, Fork).
        state.priorityPlayerId = state.pendingTarget.playerId;
    } else {
        // Full resolution completed — priority returns to the active
        // player (CR 117.3d).
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
    }
}

/** The resolve/priority epilogue. Call after {@link dequeueHead}: while
 *  another choice is still queued the resolution stays suspended on it;
 *  otherwise the top of the stack resumes and priority is handed on. */
export function resumeAfterChoice(
    state: GameState,
    options: ResumeOptions
): void {
    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
        return;
    }
    resolveTopOfStack(state);
    handPriorityOn(state, options.pendingTargetHandoff);
    if (options.stateBasedActions) checkStateBasedActions(state);
}
