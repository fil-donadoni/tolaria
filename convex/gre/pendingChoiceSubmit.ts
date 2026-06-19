// Atomic, client-buffered submission of a mid-resolution PendingChoice
// (CR 608.2, 101.4). Replaces the per-click `selectResolutionChoice` server
// accumulation for kinds that have been migrated. See ADR 0007.

import {
    getPendingChoiceMax,
    getPendingChoiceMin,
    getPlayer,
    matchesPermanentFilter,
    resolveTopOfStack,
    normalizeManaCost,
    isManaCostCovered,
    getManaSubstitutions,
    payManaCost,
    commitLandsForCost,
    type CardInstanceState,
    type GameState,
} from "./state";
import {
    computeHardSkipFilters,
    drainAutoPasses,
    effectivePermanentView,
    finalizeCleanupDiscard,
    finalizeDrawLookKeep,
    finalizeUntapPick,
} from "./phases";
import { checkStateBasedActions, finalizeLegendKeep } from "./sba";
import { applyMulliganBottomChoice } from "./mulligan";

export type SubmitChoiceArgs = {
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    cardInstanceIds: string[];
};

export type SubmitMayPayArgs = {
    playerId: string;
    accept: boolean;
};

/** Validates and applies a yes/no `may-pay` submission (CR 117.3a / 118.4)
 *  against the current head pending choice. Mutates `state` in place. On accept
 *  with a cost, the cost is paid from the player's mana pool (lands must already
 *  have been tapped via `tapForPayment`); throws if the pool can't cover it.
 *  Throws on identity mismatch or a non-`may-pay` head. Extracted from the
 *  `submitMayPay` mutation so the mutation and the bot's resolution path
 *  (ADR 0016) drive the SAME primitive. */
export function applyMayPaySubmit(
    state: GameState,
    args: SubmitMayPayArgs
): void {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) throw new Error("No pending choice");
    const head = queue[0];
    if (head.kind !== "may-pay") {
        throw new Error("Pending choice is not a may-pay");
    }
    if (head.playerId !== args.playerId) {
        throw new Error("Not your pending choice");
    }

    if (args.accept && head.cost) {
        const player = getPlayer(state, args.playerId);
        const normalized = normalizeManaCost(head.cost);
        const subs = getManaSubstitutions(state, player.id);
        if (!isManaCostCovered(player.manaPool, normalized, subs)) {
            throw new Error("Cannot pay the cost from your current mana pool");
        }
        payManaCost(player.manaPool, normalized, subs);
        commitLandsForCost(player, normalized);
    }

    const answer = [args.accept ? "yes" : "no"];

    // Commit into the stack item's collectedChoices so the resolve step
    // re-invocation reads the answer back via requestMayPay.
    const stackItem = state.stack.find((s) => s.id === head.stackItemId);
    if (!stackItem) throw new Error("Stack item not found");
    const key = `${head.step}:${head.choiceId}`;
    stackItem.collectedChoices = {
        ...(stackItem.collectedChoices ?? {}),
        [key]: answer,
    };

    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;

    if ((state.pendingChoices?.length ?? 0) === 0) {
        resolveTopOfStack(state);
        if ((state.pendingChoices?.length ?? 0) > 0) {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        } else if (state.pendingTarget) {
            // Resolution requested a copy-retarget (CR 707.10b, Fork).
            state.priorityPlayerId = state.pendingTarget.playerId;
        } else {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }
        checkStateBasedActions(state);
    } else {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
    }
}

export type RandomRevealAckArgs = {
    playerId: string;
    stackItemId: string;
    choiceId: string;
};

/** Resumes a suspended `random-reveal` flip (CR 705.2, ADR 0023). The outcome
 *  was already drawn ONCE and persisted into the stack item's
 *  `collectedChoices` by `requestCoinFlip`; this carries NO choice data — it
 *  only means "the animation finished, resume". Validates the queue head is a
 *  `random-reveal` for this player/stack item, removes it, and re-enters
 *  resolution; the replayed step reads the persisted bit back (no re-roll) and
 *  applies the consequence. The same generic mutation serves coins and future
 *  dice. Mutates `state` in place; throws on a mismatched/missing head. */
export function applyRandomRevealAck(
    state: GameState,
    args: RandomRevealAckArgs
): void {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) throw new Error("No pending choice");
    const head = queue[0];
    if (head.kind !== "random-reveal") {
        throw new Error("Pending choice is not a random reveal");
    }
    if (head.stackItemId !== args.stackItemId) {
        throw new Error("Stack item mismatch");
    }
    if (head.choiceId !== args.choiceId) {
        throw new Error("Choice id mismatch");
    }
    // The realized bit already lives in `collectedChoices` (written by
    // requestCoinFlip). The ack only drops the head and resumes — replay-safe
    // regardless of which client acks (the chooser auto-acks; the gate avoids
    // a double submit, but a duplicate is harmless because the choice is gone).
    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;

    if ((state.pendingChoices?.length ?? 0) === 0) {
        resolveTopOfStack(state);
        if ((state.pendingChoices?.length ?? 0) > 0) {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        } else if (state.pendingTarget) {
            state.priorityPlayerId = state.pendingTarget.playerId;
        } else {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
            drainAutoPasses(state);
        }
        checkStateBasedActions(state);
    } else {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
    }
}

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

    // --- "Any target" choice (CR 115.4): the pick is a damageable permanent
    // OR a player (Cuombajj Witches — "1 damage to any target of an
    // opponent's choice"). Players aren't in a zone, so this kind validates
    // against its own allow-lists rather than the zone-membership check
    // below. The single picked id is written verbatim into collectedChoices
    // and the card's resolve step disambiguates permanent vs player. ---
    if (head.kind === "choose-damage-target") {
        const id = args.cardInstanceIds[0];
        const playerOk = head.candidatePlayerIds?.includes(id) ?? false;
        const permanentOk = head.candidateIds?.includes(id) ?? false;
        if (!playerOk && !permanentOk) {
            throw new Error("Not a legal target");
        }
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
                state.priorityPlayerId = state.activePlayerId;
                state.passCount = 0;
                drainAutoPasses(state);
            }
        } else {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        }
        return;
    }

    // --- Abstract option pick (CR 614.12 "as it enters, choose …"): the pick
    // is one author-supplied option id, not a zone member. Validates against
    // `head.options` (like `choose-damage-target` validates against its
    // allow-lists) and writes the chosen id verbatim into `collectedChoices`;
    // the card's resolve step reads it back via `requestOptionChoice`. ---
    if (head.kind === "option-pick") {
        const id = args.cardInstanceIds[0];
        if (!head.options?.some((o) => o.id === id)) {
            throw new Error("Not a legal choice");
        }
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
                state.priorityPlayerId = state.activePlayerId;
                state.passCount = 0;
                drainAutoPasses(state);
            }
            checkStateBasedActions(state);
        } else {
            state.priorityPlayerId = state.pendingChoices![0].playerId;
        }
        return;
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
            // CR 202.2 — match against the effective view so color/tapped
            // filters (Magnetic Mountain) validate with colors populated.
            if (
                head.filter &&
                !matchesPermanentFilter(
                    effectivePermanentView(state, card),
                    head.filter
                )
            ) {
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
            // Allow-list (Aladdin's Lamp): only the looked-at top cards are
            // eligible, not the whole (hidden) library.
            if (head.candidateIds && !head.candidateIds.includes(id)) {
                throw new Error("Card is not an eligible choice");
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

    if (head.kind === "draw-look-keep") {
        // CR 614 (Aladdin's Lamp) — phase-level draw replacement. The reorder +
        // draw + priority resumption live in `finalizeDrawLookKeep`.
        finalizeDrawLookKeep(state, args.cardInstanceIds);
        return;
    }

    if (head.kind === "legend-keep" && head.stackItemId === "") {
        // CR 704.5j (#378) — SBA-level keep-one. The submission must be exactly
        // one of the recorded same-name duplicates; the battlefield zone check
        // above already verified it is on the chooser's battlefield. The
        // graveyard moves, queue shift, SBA re-sweep, and priority resumption
        // live in `finalizeLegendKeep`.
        if (!head.candidateIds?.includes(args.cardInstanceIds[0])) {
            throw new Error("Card is not an eligible choice");
        }
        finalizeLegendKeep(state, args.cardInstanceIds);
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
