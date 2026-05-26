// Atomic, client-buffered submission of a mid-resolution PendingChoice
// (CR 608.2, 101.4). Replaces the per-click `selectResolutionChoice` server
// accumulation for kinds that have been migrated. See ADR 0007.

import {
    getPendingChoiceMax,
    getPendingChoiceMin,
    getPlayer,
    resolveTopOfStack,
    type GameState,
} from "./state";
import { drainAutoPasses, finalizeCleanupDiscard } from "./phases";

export type SubmitChoiceArgs = {
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

/** Validates and applies a client-buffered submission against the current
 *  head pending choice. Mutates `state` in place. Throws on validation
 *  failure (identity mismatch, stale queue head, unsupported kind,
 *  duplicate ids, count outside `[min, max]`, ids not in the chooser's
 *  zone). Each thrown message is user-facing — the client surfaces it via
 *  a transient toast (see ADR 0007).
 *
 *  Slice #80 handles `discard-hand` only; other kinds still flow through
 *  `selectResolutionChoice` until their migration slices land. */
export function applyPendingChoiceSubmit(
    state: GameState,
    args: SubmitChoiceArgs
): void {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) throw new Error("No pending choice");
    const head = queue[0];

    if (
        head.stackItemId !== args.stackItemId ||
        head.step !== args.step ||
        head.choiceId !== args.choiceId ||
        head.playerId !== args.playerId
    ) {
        throw new Error("Stale pending choice — try again");
    }

    if (head.kind !== "discard-hand") {
        throw new Error(
            `submitResolutionChoice does not yet handle kind=${head.kind}`
        );
    }

    if (new Set(args.cardInstanceIds).size !== args.cardInstanceIds.length) {
        throw new Error("Duplicate ids in submission");
    }

    const min = getPendingChoiceMin(head.count);
    const max = getPendingChoiceMax(head.count);
    if (args.cardInstanceIds.length < min) {
        throw new Error(
            min === 1
                ? "Select at least 1 card"
                : `Select at least ${min} cards`
        );
    }
    if (args.cardInstanceIds.length > max) {
        throw new Error(
            max === 1 ? "Select at most 1 card" : `Select at most ${max} cards`
        );
    }

    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? args.playerId);
    for (const id of args.cardInstanceIds) {
        if (!zoneOwner.hand.find((c) => c.id === id)) {
            throw new Error("Card not in hand");
        }
    }

    if (head.stackItemId === "" && state.pendingCleanupDiscard) {
        // CR 514.1 phase-level cleanup discard. `finalizeCleanupDiscard`
        // handles the move, queue shift, CR 514.2 cleanup, and phase
        // advancement.
        finalizeCleanupDiscard(state, args.cardInstanceIds);
        return;
    }

    // Mid-resolution choice (CR 608.2): write picks into the stack item's
    // `collectedChoices` so the next invocation of the resolve step reads
    // them back via `requestChoice`.
    const stackItem = state.stack.find((s) => s.id === head.stackItemId);
    if (!stackItem) throw new Error("Stack item not found");
    const key = `${head.step}:${head.choiceId}`;
    stackItem.collectedChoices = {
        ...(stackItem.collectedChoices ?? {}),
        [key]: args.cardInstanceIds,
    };

    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;

    if ((state.pendingChoices?.length ?? 0) === 0) {
        resolveTopOfStack(state);
        if ((state.pendingChoices?.length ?? 0) > 0) {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        } else {
            // Full resolution completed — priority returns to the active
            // player (CR 117.3d).
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }
    } else {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
    }
}
