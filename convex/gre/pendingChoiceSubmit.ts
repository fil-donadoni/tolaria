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
    getMayPaySacrificeCandidateIds,
    mayPaySacrificeChoiceRequired,
    mayPaySacrificeThreshold,
    mayPaySacrificeSetPower,
    getMayPayDiscardCandidateIds,
    mayPayDiscardChoiceRequired,
    normalizeMayPayCost,
    grantKnowledge,
    finalizeAuraHost,
    type CardInstanceState,
    type GameState,
} from "./state";
import { isCategorizedPickLegal } from "./categorizedPick";
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
import { raiseTriggerTargetSelection } from "./rules";

export type SubmitChoiceArgs = {
    playerId: string;
    stackItemId: string;
    step: number;
    choiceId: string;
    /** The primary ordered selection. For `order-top` this is the KEPT cards in
     *  final top-to-bottom order (topmost first); for every other kind it is the
     *  single picked set. */
    cardInstanceIds: string[];
    /** For `kind: "order-top"` only — the un-kept looked-at cards, ordered, sent
     *  to the choice's `destination` (bottom of library / graveyard). Together
     *  with `cardInstanceIds` these MUST partition the looked-at `candidateIds`.
     *  Omitted (or empty) for `destination: "none"` and every other kind. */
    secondZoneIds?: string[];
};

export type SubmitMayPayArgs = {
    playerId: string;
    accept: boolean;
    /** CR 701.16b — the payer's chosen sacrifice victim id(s) for a may-pay
     *  whose sacrifice leg admits a real choice (more matching permanents than
     *  the leg sacrifices). Required (exactly `count` ids) in that case; ignored
     *  when the pick auto-resolves (single candidate / `count` covers all) or the
     *  accepted cost has no sacrifice leg. */
    sacrificeIds?: string[];
    /** CR 701.9 / 118.3 (issue #899) — the payer's chosen hand card id(s) for a
     *  may-pay whose discard leg admits a real choice (more hand cards than
     *  the leg discards). Required (exactly `count` ids) in that case; ignored
     *  when the pick auto-resolves (hand size ≤ `count`) or the accepted cost
     *  has no discard leg. Mirrors `sacrificeIds`. */
    discardIds?: string[];
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
        // CR 701.16b — validate the payer's sacrifice pick when the leg admits a
        // real choice. The candidate set is recomputed live (the board may have
        // shifted since the choice was enqueued). Two shapes:
        //   - fixed cardinal (`count: number`): the pick must name exactly
        //     `count` distinct, currently-legal candidates.
        //   - threshold (`count: { minTotalPower }`, CR 118, Phyrexian
        //     Dreadnought): the pick may be any number of distinct, currently
        //     legal candidates whose summed EFFECTIVE power ≥ the threshold.
        //     Over-payment is allowed; no upper bound, no minimality.
        // When no choice is required the ids are ignored and the pay auto-selects.
        let sacrificeIds = args.sacrificeIds;
        if (mayPaySacrificeChoiceRequired(state, args.playerId, head.cost)) {
            const norm = normalizeMayPayCost(head.cost);
            const ids = args.sacrificeIds ?? [];
            if (new Set(ids).size !== ids.length) {
                throw new Error("Duplicate sacrifice choice");
            }
            const legal = new Set(
                getMayPaySacrificeCandidateIds(state, args.playerId, head.cost)
            );
            for (const id of ids) {
                if (!legal.has(id)) {
                    throw new Error("Illegal sacrifice choice");
                }
            }
            const threshold = mayPaySacrificeThreshold(head.cost);
            if (threshold !== undefined) {
                if (ids.length === 0) {
                    throw new Error("Must choose permanents to sacrifice");
                }
                const total = mayPaySacrificeSetPower(
                    state,
                    args.playerId,
                    ids
                );
                if (total < threshold) {
                    throw new Error(
                        `Chosen permanents' total power (${total}) is below the required ${threshold}`
                    );
                }
            } else {
                const need = norm.sacrifice!.count as number;
                if (ids.length !== need) {
                    throw new Error(
                        `Must choose ${need} permanent(s) to sacrifice`
                    );
                }
            }
        } else {
            sacrificeIds = undefined;
        }
        // CR 701.9 / 118.3 (issue #899) — validate the payer's discard pick
        // when the leg admits a real choice. Mirrors the sacrifice validation
        // above: fixed cardinal only (no threshold shape for discard), the
        // candidate set (the payer's current hand) is recomputed live. When no
        // choice is required the ids are ignored and the pay auto-selects.
        let discardIds = args.discardIds;
        if (mayPayDiscardChoiceRequired(state, args.playerId, head.cost)) {
            const norm = normalizeMayPayCost(head.cost);
            const ids = args.discardIds ?? [];
            if (new Set(ids).size !== ids.length) {
                throw new Error("Duplicate discard choice");
            }
            const legal = new Set(
                getMayPayDiscardCandidateIds(state, args.playerId, head.cost)
            );
            for (const id of ids) {
                if (!legal.has(id)) {
                    throw new Error("Illegal discard choice");
                }
            }
            const need = norm.discard!.count;
            if (ids.length !== need) {
                throw new Error(`Must choose ${need} card(s) to discard`);
            }
        } else {
            discardIds = undefined;
        }
        payMayPayCost(
            state,
            args.playerId,
            head.cost,
            head.manaRestriction,
            sacrificeIds,
            discardIds
        );
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
    // CR 201.3 (issue #1085) — "a card name other than a basic land card
    // name" (Desperate Research). A basic land CARD, not just a land with a
    // basic land TYPE — checked against the printed characteristics, mirroring
    // every other registry-backed name restriction in this pipeline.
    if (
        head.nameRestriction === "no-basic-land" &&
        def.supertypes?.includes("Basic") &&
        def.types.includes("Land")
    ) {
        throw new Error("Choose a card name other than a basic land card name");
    }

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

    // --- Trigger-time player pick (CR 115.1a): the pick is a player id, not a
    // zone member (Endurance — "up to one target player"). Validates against
    // `candidatePlayerIds`; an EMPTY submission is legal ("up to one" = none,
    // `count.min === 0`). The generic min/max check above already bounds the
    // count. Writes the (0- or 1-element) selection verbatim into
    // collectedChoices; the card's resolve step reads it back via requestChoice
    // and acts only when a player was chosen. ---
    if (head.kind === "choose-player") {
        for (const id of args.cardInstanceIds) {
            if (!(head.candidatePlayerIds?.includes(id) ?? false)) {
                throw new Error("Not a legal player");
            }
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

    // --- Pick a pile (ADR 0053, pile division — step 2 of the divide-then-
    // choose family): the submission is the literal label "A" or "B", not a
    // zone member id. Validates against the two completed piles' labels
    // (mirrors `option-pick`'s allow-list validation) and writes the chosen
    // label verbatim into `collectedChoices`; `divideIntoPiles`'s resolve
    // step reads it back via `requestPickPile`. ---
    if (head.kind === "pick-pile") {
        const id = args.cardInstanceIds[0];
        if (id !== "A" && id !== "B") {
            throw new Error('Pile choice must be "A" or "B"');
        }
        const stackItem = state.stack.find((s) => s.id === head.stackItemId);
        if (!stackItem) throw new Error("Stack item not found");
        const key = `${head.step}:${head.choiceId}`;
        stackItem.collectedChoices = {
            ...(stackItem.collectedChoices ?? {}),
            [key]: [id],
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

    // --- Trigger-order (CR 603.3b, ADR 0058): order this controller's slice of
    // the off-stack simultaneous-trigger batch. The submission is a permutation
    // of `candidateIds` (the slice), TOPMOST-first (index 0 = top of stack =
    // resolves first). Reorder the slice within `pendingTriggerBatch`; when the
    // last `trigger-order` choice clears, push the whole batch onto the stack in
    // one shot (bottom-first, APNAP-grouped) and hand priority to the active
    // player (CR 117.3c). Held off-stack until then, so the stack is never
    // observed half-ordered. ---
    if (head.kind === "trigger-order") {
        const sliceIds = head.candidateIds ?? [];
        const submitted = args.cardInstanceIds;
        if (
            submitted.length !== sliceIds.length ||
            new Set(submitted).size !== submitted.length ||
            !submitted.every((id) => sliceIds.includes(id))
        ) {
            throw new Error(
                "Trigger order must be a permutation of your triggers"
            );
        }
        const batch = state.pendingTriggerBatch ?? [];
        // UI submits topmost-first; the batch stores bottom-first (resolve-last
        // first). Reverse to slot this player's slice back in stack order.
        const bottomFirst = [...submitted].reverse();
        const inSlice = new Set(sliceIds);
        const byId = new Map(batch.map((it) => [it.id, it]));
        const next = [...bottomFirst];
        state.pendingTriggerBatch = batch.map((it) =>
            inSlice.has(it.id) ? byId.get(next.shift()!)! : it
        );

        queue.shift();
        const nextHead = queue[0];
        if (nextHead && nextHead.kind === "trigger-order") {
            // Another controller still owes an ordering (APNAP): stay suspended.
            state.pendingChoices = queue;
            state.priorityPlayerId = nextHead.playerId;
            return;
        }
        // Last ordering in: land the whole batch atomically, then resume.
        state.pendingChoices = queue.length > 0 ? queue : undefined;
        const finalBatch = state.pendingTriggerBatch ?? [];
        state.pendingTriggerBatch = undefined;
        state.stack.push(...finalBatch);
        // CR 603.3d (issue #1193) — the ordered triggers are now on the stack;
        // each targeted one chooses its target(s) as it is placed. If a
        // controller must choose, suspend on the `kind:"trigger"` PendingTarget
        // (priority already parked on the chooser); otherwise resume the active
        // player's priority window.
        if (!raiseTriggerTargetSelection(state)) {
            state.priorityPlayerId = state.activePlayerId;
            state.passCount = 0;
        }
        checkStateBasedActions(state);
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
            // look-distribute HAND-pile gate (issue #1266, Narset): a
            // looked-at card outside `eligibleIds` (the "noncreature, nonland"
            // subset) may only be bottomed — never taken to hand.
            if (
                head.kind === "look-distribute" &&
                head.eligibleIds &&
                !head.eligibleIds.includes(id)
            ) {
                throw new Error("Card is not eligible to put into your hand");
            }
        }
        // Categorized keep (issue #1364, Atraxa): at most one card per
        // category, and a card qualifying for several categories may be kept
        // for only ONE of them — so the hand picks are legal exactly when an
        // injective card → category assignment exists. Greedy checking is
        // unsound here (an artifact creature seated as "Creature" can strand a
        // plain creature), so this runs the same bipartite matching the client
        // gates its clicks with.
        if (head.kind === "look-distribute" && head.categories) {
            if (
                !isCategorizedPickLegal(head.categories, args.cardInstanceIds)
            ) {
                throw new Error(
                    "Those cards can't each be kept for a different category"
                );
            }
        }
        if (head.kind === "order-top" || head.kind === "look-distribute") {
            // The second-zone cards (`secondZoneIds`) must also be looked-at
            // library cards, disjoint from the primary list.
            const second = args.secondZoneIds ?? [];
            for (const id of second) {
                if (
                    !zoneOwner.library.find(
                        (c: CardInstanceState) => c.id === id
                    )
                ) {
                    throw new Error("Card not in library");
                }
                if (head.candidateIds && !head.candidateIds.includes(id)) {
                    throw new Error("Card is not an eligible choice");
                }
            }
            const placed = [...args.cardInstanceIds, ...second];
            const placedSet = new Set(placed);
            if (placedSet.size !== placed.length) {
                throw new Error("A card was placed more than once");
            }
            // `order-top` (CR 701.22/701.44) always places EVERY looked-at card:
            // the two lists must partition `candidateIds` exactly. `look-
            // distribute` (CR 401.4 — Impulse, Stock Up) partitions too WHEN the
            // picker supplies the ordered bottom list, but a bot/auto path may
            // submit only the hand picks and let the rest auto-bottom in look
            // order — so the full-cover check applies to `order-top` always, and
            // to `look-distribute` only when a second list is present.
            const requireFullCover =
                head.kind === "order-top" || second.length > 0;
            if (
                requireFullCover &&
                placedSet.size !== (head.candidateIds?.length ?? placed.length)
            ) {
                throw new Error(
                    head.kind === "order-top"
                        ? "order-top must place every looked-at card once"
                        : "look-distribute must place every looked-at card once"
                );
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
    } else if (head.zone === "exile") {
        // Dauthi Voidwalker (issue #1156) — choose an exiled card matching a
        // filter (typically `hasCounter`). Exile is public (CR 400.2);
        // eligibility is the snapshot taken when the choice was raised,
        // carried verbatim in `candidateIds`, mirroring the graveyard branch.
        for (const id of args.cardInstanceIds) {
            if (!zoneOwner.exile.find((c: CardInstanceState) => c.id === id)) {
                throw new Error("Card not in exile");
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

    if (head.kind === "choose-aura-host" && head.stackItemId === "") {
        // CR 303.4f — non-cast Aura host pick. The battlefield + candidateIds
        // validation above already verified the selection is a legal host; the
        // attach, staged-entry removal, SBA re-sweep, and priority resumption
        // live in `finalizeAuraHost`.
        if (!head.candidateIds?.includes(args.cardInstanceIds[0])) {
            throw new Error("Card is not an eligible choice");
        }
        finalizeAuraHost(state, args.cardInstanceIds);
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
        // `order-top` / `look-distribute` carry a SECOND ordered list under a
        // sibling key; `SpellContext.orderTop` / `digToHand` read it back on
        // resume to apply the destination split.
        ...(head.kind === "order-top" || head.kind === "look-distribute"
            ? { [`${key}:second`]: args.secondZoneIds ?? [] }
            : {}),
    };

    // ADR 0026 / PRD #338 — a `reorder-library` choice is "look at the top N,
    // then put them back in any order" (CR 401.4): the chooser SAW and PLACED
    // these cards, so their positions are certain and stay known to the chooser
    // until a shuffle clears the library. Granting it here (at the choice's
    // resolution) makes it automatic for EVERY "put them back in any order" card
    // — Portent, Drafna's Restoration, Elemental Augury, Natural Selection — so
    // no card needs its own `markKnown`. `order-top` (Ponder/scry) already
    // grants this inside `orderTop`; this is the parallel for the closure-driven
    // reorder path. The cards live in `zoneOwnerId ?? playerId`'s library (the
    // target's for a Portent aimed at the opponent), known to the chooser.
    if (head.kind === "reorder-library") {
        grantKnowledge(
            state,
            head.zoneOwnerId ?? head.playerId,
            args.cardInstanceIds,
            head.playerId
        );
    }

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
