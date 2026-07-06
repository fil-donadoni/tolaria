// Atomic, client-buffered submission of a mid-resolution PendingChoice
// (CR 608.2, 101.4). Replaces the per-click `selectResolutionChoice` server
// accumulation for kinds that have been migrated. See ADR 0007.

import {
    getPendingChoiceMax,
    getPendingChoiceMin,
    getPlayer,
    matchesPermanentFilter,
    resolveTopOfStack,
    canPayMayPayCost,
    payMayPayCost,
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
import { tryGetCardByName } from "../cards";
import { finalizeLandEntry } from "./playLand";

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
        // CR 117.3a / 118.4 / 702.24 — pay the whole cost union (mana, life,
        // sacrifice) all-or-nothing. `canPayMayPayCost` gates affordability for
        // every leg; the mana leg still requires the pool to already be tapped.
        if (
            !canPayMayPayCost(
                state,
                args.playerId,
                head.cost,
                head.manaRestriction
            )
        ) {
            throw new Error("Cannot pay the cost");
        }
        payMayPayCost(state, args.playerId, head.cost, head.manaRestriction);
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

export type SubmitLandEntryArgs = {
    playerId: string;
    accept: boolean;
};

/** Validates and applies a `land-entry-tapped` submission (CR 614.12, ADR 0051)
 *  against the current head pending choice — the shock-land pay-choice. On
 *  accept the cost is paid (gated by `canPayMayPayCost`; throws if unaffordable)
 *  to skip the land's own tapped clause; either way `finalizeLandEntry`
 *  completes the suspended entry (moving the land from hand to battlefield,
 *  tapped iff declined OR forced by another source). Unlike `applyMayPaySubmit`
 *  there is NO stack item: a land is played, not cast, so resolution resumes to
 *  the active player's priority window rather than `resolveTopOfStack`. Throws
 *  on identity mismatch or a non-`land-entry-tapped` head. Extracted from the
 *  `submitLandEntryChoice` mutation so the mutation and the bot's resolution
 *  path (ADR 0016) drive the SAME primitive. */
export function applyLandEntrySubmit(
    state: GameState,
    args: SubmitLandEntryArgs
): void {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) throw new Error("No pending choice");
    const head = queue[0];
    if (head.kind !== "land-entry-tapped") {
        throw new Error("Pending choice is not a land-entry-tapped");
    }
    if (head.playerId !== args.playerId) {
        throw new Error("Not your pending choice");
    }
    if (!head.landInstanceId || !head.cost) {
        throw new Error("Malformed land-entry choice");
    }

    if (args.accept && !canPayMayPayCost(state, args.playerId, head.cost)) {
        throw new Error("Cannot pay the cost");
    }

    queue.shift();
    state.pendingChoices = queue.length > 0 ? queue : undefined;

    finalizeLandEntry(
        state,
        args.playerId,
        head.landInstanceId,
        head.cost,
        args.accept
    );

    // CR 614.12 — a played land is not a stack resolution; resume priority to
    // the active player (any ETB triggers `settleEnteredLand` pushed sit on the
    // stack for that window), then settle SBAs. If somehow another choice was
    // enqueued during finalize, hand priority to its chooser.
    if ((state.pendingChoices?.length ?? 0) > 0) {
        state.priorityPlayerId = state.pendingChoices![0].playerId;
    } else {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
    }
    checkStateBasedActions(state);
}

export type SubmitNameCardArgs = {
    playerId: string;
    cardName: string;
};

/** Validates and applies a `name-card` submission (CR 202.3 / 701.x "chooses a
 *  card name") against the current head pending choice. The submitted name must
 *  resolve (case-insensitively) to a card in the registry — naming a card that
 *  isn't implemented is rejected (a user-facing throw). On success the chosen
 *  name is committed into the stack item's `collectedChoices` so the resolve
 *  step reads it back via `requestNameCard`, then the head is dropped and
 *  resolution resumes. Mutates `state` in place. Throws on identity mismatch,
 *  a non-`name-card` head, or an unregistered name. Mirrors `applyMayPaySubmit`
 *  so the mutation and the bot's headless resolution path drive the SAME
 *  primitive. */
export function applyNameCardSubmit(
    state: GameState,
    args: SubmitNameCardArgs
): void {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) throw new Error("No pending choice");
    const head = queue[0];
    if (head.kind !== "name-card") {
        throw new Error("Pending choice is not a name-card");
    }
    if (head.playerId !== args.playerId) {
        throw new Error("Not your pending choice");
    }

    const name = args.cardName.trim();
    if (name.length === 0) throw new Error("Name a card");
    // CR 201.2 — the named card must exist (here: be in the registry). The
    // registry is the canonical card name set; an unregistered name is illegal.
    const def = tryGetCardByName(name);
    if (!def) throw new Error("Not a recognized card name");
    // Normalize to the registry's canonical casing so the resolve step's name
    // comparison is exact.
    const canonical = def.name;

    head.chosenName = canonical;
    const stackItem = state.stack.find((s) => s.id === head.stackItemId);
    if (!stackItem) throw new Error("Stack item not found");
    const key = `${head.step}:${head.choiceId}`;
    stackItem.collectedChoices = {
        ...(stackItem.collectedChoices ?? {}),
        [key]: [canonical],
    };

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
    // `name-card` has its own mutation (`submitNameCard`) — reject here.
    if (head.kind === "name-card") {
        throw new Error("Use submitNameCard for name-card choices");
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
            // Precomputed eligibility allow-list (Camouflage's per-pile pick:
            // each pile draws only from the still-unassigned creatures, so a
            // creature already placed in an earlier pile is rejected here).
            if (head.candidateIds && !head.candidateIds.includes(id)) {
                throw new Error("Card is not an eligible choice");
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
    } else if (head.zone === "graveyard") {
        // Recall (LEG) — return N cards from the chooser's graveyard to hand
        // (CR 400.7). The graveyard is public; eligibility is the snapshot taken
        // when the choice was raised (after any earlier discard in the same
        // resolution), carried verbatim in `candidateIds`.
        for (const id of args.cardInstanceIds) {
            if (
                !zoneOwner.graveyard.find((c: CardInstanceState) => c.id === id)
            ) {
                throw new Error("Card not in graveyard");
            }
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
