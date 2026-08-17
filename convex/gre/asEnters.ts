/** The as-enters choice FINALIZE (CR 614.1c / 614.12a, ADR 0100 D5).
 *
 *  This is the FIFTH early-return finalize beside the four shipped ones
 *  (`finalizeDrawLookKeep`, `finalizeLegendKeep`, `finalizeCleanupDiscard`, and
 *  the pay-choice `finalizeLandEntry`): `applyPendingChoiceSubmit` routes an
 *  as-enters submission here and returns, never falling into its generic
 *  mid-resolution tail. It cannot fall into that tail — an as-enters park
 *  enqueues with `stackItemId: ""`, and the generic path throws
 *  `Stack item not found` on `state.stack.find((s) => s.id === "")` first — so
 *  this module REPRODUCES the tail's completion logic instead.
 *
 *  It lives in its own module rather than in `gre/state.ts` because it is the
 *  only layer allowed to decide priority: it needs `resolveTopOfStack` (state)
 *  AND `drainAutoPasses` (phases), and `state.ts` cannot import `phases.ts`. */
import { drainAutoPasses } from "./phases";
import { checkStateBasedActions } from "./sba";
import type { GameState } from "./state";
import {
    advanceStagedEntry,
    findStagedEntry,
    resolveTopOfStack,
} from "./state";

/** ADR 0100 D5 — commit one answered as-enters choice and decide what happens
 *  next. No-op unless the head of the queue is a stackless as-enters choice
 *  (`asEntersCardId` set — the explicit, fail-closed discriminator).
 *
 *  Three outcomes, in order:
 *   1. the staged entry still owes choices (the list may have GROWN, CR 707.6)
 *      → the next prompt is already queued, priority stays on its chooser;
 *   2. every choice is answered and the parking stack item is STILL on the
 *      stack → `resolveTopOfStack` resumes that suspended resolution in this
 *      same mutation (resolution is peek-and-pop, so the item that parked the
 *      entry is genuinely still there), and priority is restored only once it
 *      completes;
 *   3. every choice is answered and there is NO live parking stack item → this
 *      finalize already ran the remainder of the entry tail itself, so priority
 *      goes back to the active player.
 *
 *  Outcome 2 vs 3 branches on `StagedEntry.parkedStackItemId` being live —
 *  never on `origin`. Routing on `origin` is correct for every case that exists
 *  today and fails open the moment a play-a-land entry is routed onto the
 *  chokepoint (#1980): CR 305.1 requires an empty stack, so an `origin:
 *  "effect"` park would take the resume branch onto an empty stack and throw
 *  `Stack is empty` — a hard freeze. On a NON-empty stack the same mistake is
 *  worse because it is silent: it resolves the next, unrelated item with no
 *  priority round, which CR 117.3b gives to nobody mid-resolution. */
export function finalizeAsEnters(state: GameState, selected: string[]): void {
    const queue = state.pendingChoices ?? [];
    const head = queue[0];
    if (!head || head.stackItemId !== "" || head.asEntersCardId === undefined) {
        return;
    }
    const entry = findStagedEntry(state, head.asEntersCardId);
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;

    // Captured BEFORE the entry is advanced: `advanceStagedEntry` unstages the
    // entry once its owed list empties, so the predicate's input has to be read
    // while the entry still exists.
    const parkedStackItemId = entry?.parkedStackItemId;
    if (entry) advanceStagedEntry(state, entry, selected);

    // The entry (an Aura attach, a control change, a body choice that leaves a
    // 0-toughness creature) may create an SBA — CR 704.3, repeat until none
    // applies. This is also what can end the game before anything resumes.
    checkStateBasedActions(state);

    resumeAfterStagedEntry(state, parkedStackItemId);
}

/** The generic post-choice tail (`gre/pendingChoiceSubmit.ts`) reproduced with
 *  two differences ADR 0100 D5 requires: the `resolveTopOfStack` branch is
 *  taken only when the PARKING stack item is still live, and the whole thing is
 *  gated on `!state.gameOver`.
 *
 *  The `gameOver` gate is carried over from the pre-ADR-0100 Aura-host finalize,
 *  which had it and the generic tail does not: without it an attach that kills
 *  a player through `checkStateBasedActions` goes on to resolve the next stack
 *  item — and to hand out priority — in a finished game. */
function resumeAfterStagedEntry(
    state: GameState,
    parkedStackItemId: string | undefined
): void {
    if (state.gameOver) return;
    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
        return;
    }
    const live =
        parkedStackItemId !== undefined &&
        state.stack.some((s) => s.id === parkedStackItemId);
    if (live) {
        resolveTopOfStack(state);
        if (state.gameOver) return;
        if ((state.pendingChoices?.length ?? 0) > 0) {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
            return;
        }
    }
    // Full resolution completed (or there was never anything to resume) —
    // priority returns to the active player (CR 117.3b — "the active player
    // receives priority after a spell or ability … resolves").
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    drainAutoPasses(state);
}
