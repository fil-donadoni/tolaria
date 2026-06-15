// Atomic, client-buffered submission of a mid-resolution PendingChoice
// (CR 608.2, 101.4). Replaces the per-click `selectResolutionChoice` server
// accumulation for kinds that have been migrated. See ADR 0007.

import {
    getPendingChoiceMax,
    getPendingChoiceMin,
    getPlayer,
    matchesPermanentFilter,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "./state";
import {
    computeHardSkipFilters,
    drainAutoPasses,
    effectivePermanentView,
    finalizeCleanupDiscard,
    finalizeUntapPick,
} from "./phases";
import { applyMulliganBottomChoice } from "./mulligan";

export type SubmitChoiceArgs = {
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

/** Validates and applies a client-buffered submission against the current
 *  head pending choice. Mutates `state` in place. Throws on validation
 *  failure (identity mismatch, may-pay kind, duplicate ids, count outside
 *  `[min, max]`, ids not in the chooser's zone). Each thrown message is
 *  user-facing — the client surfaces it via a transient toast (ADR 0007).
 *  Handles all zone-pick kinds; `may-pay` stays on `submitMayPay`. */
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

    // `may-pay` has its own mutation (`submitMayPay`) — reject here.
    if (head.kind === "may-pay") {
        throw new Error("Use submitMayPay for may-pay choices");
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

    // --- Zone-level validation: verify every id exists in the declared zone ---
    if (head.zone === "battlefield") {
        // CR 707 — `allControllers` choices (Clone / Copy Artifact) draw from
        // every player's battlefield, not just one owner's.
        const pool: CardInstanceState[] = head.allControllers
            ? state.players.flatMap((p) => p.battlefield)
            : zoneOwner.battlefield;
        for (const id of args.cardInstanceIds) {
            const card = pool.find((c: CardInstanceState) => c.id === id);
            if (!card) throw new Error("Card not on battlefield");
            if (head.filter && !matchesPermanentFilter(card, head.filter)) {
                throw new Error("Card does not match the required filter");
            }
        }
    } else if (head.zone === "hand") {
        for (const id of args.cardInstanceIds) {
            if (!zoneOwner.hand.find((c: CardInstanceState) => c.id === id)) {
                throw new Error("Card not in hand");
            }
            // Precomputed eligibility allow-list (Illusionary Mask): a pick
            // outside it is illegal even though it's in the chooser's hand.
            if (head.candidateIds && !head.candidateIds.includes(id)) {
                throw new Error("Card is not an eligible choice");
            }
        }
    } else if (head.zone === "library") {
        for (const id of args.cardInstanceIds) {
            if (
                !zoneOwner.library.find((c: CardInstanceState) => c.id === id)
            ) {
                throw new Error("Card not in library");
            }
        }
    }

    // --- Kind-specific dispatchers ---

    if (head.kind === "mulligan-bottom") {
        applyMulliganBottomChoice(state, args.cardInstanceIds);
        state.pendingChoices =
            (state.pendingChoices?.length ?? 0) > 0
                ? state.pendingChoices
                : undefined;
        if ((state.pendingChoices?.length ?? 0) === 0) {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }
        return;
    }

    if (head.kind === "untap-pick") {
        // CR 502.1: additional untap-pick constraints beyond zone validation.
        const vetoFilters = computeHardSkipFilters(state);
        for (const id of args.cardInstanceIds) {
            const card = zoneOwner.battlefield.find(
                (c: CardInstanceState) => c.id === id
            )!;
            if (!card.isTapped) throw new Error("Card is not tapped");
            if (card.staticAbilities.includes("does-not-untap")) {
                throw new Error("Card cannot untap");
            }
            const view = effectivePermanentView(state, card);
            if (vetoFilters.some((f) => matchesPermanentFilter(view, f))) {
                throw new Error("Card cannot untap");
            }
        }
        finalizeUntapPick(state, args.cardInstanceIds);
        return;
    }

    if (
        head.kind === "discard-hand" &&
        head.stackItemId === "" &&
        state.pendingCleanupDiscard
    ) {
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
