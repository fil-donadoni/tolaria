// The submit column of the Pending Choice handler registry (issue #4443): one
// handler per `PendingChoiceKind`, called by `applyPendingChoiceSubmit` once
// the submission's identity has been checked and the as-enters family has
// been routed. Each handler validates the payload for its kind, applies it,
// and — for a mid-resolution answer — returns into the shared epilogue in
// `pendingChoiceResume.ts`. Every thrown message is user-facing (ADR 0007).
// Handlers are hoisted `function` declarations, never `const`s, so the table
// that reads them is safe whichever module of an import cycle loads first.

import {
    getPendingChoiceMax,
    getPendingChoiceMin,
    getPlayer,
    matchesPermanentFilter,
    grantKnowledge,
    emitLibrarySearchedEvent,
    enqueueFailToFindNotice,
    type CardInstanceState,
    type GameState,
    type PendingChoice,
} from "./state";
import {
    isCategorizedCoverLegal,
    isCategorizedPickLegal,
} from "./categorizedPick";
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
import { raiseTriggerTargetSelection } from "./rules";
import {
    commitChoiceAnswer,
    dequeueHead,
    resumeAfterChoice,
} from "./pendingChoiceResume";
import type { SubmitChoiceArgs } from "./pendingChoiceSubmit";

/** One kind's answer to a `submitResolutionChoice` submission. `queue` is the
 *  live `state.pendingChoices` array whose head is `head`. */
export type ChoiceSubmitHandler = (
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
) => void;

/** A kind answered by its OWN mutation: refused here, naming that mutation,
 *  rather than falling into a tail that would write the ids into
 *  `collectedChoices` where no resolve step reads them (issue #4440). */
export function answeredBy(mutation: string): ChoiceSubmitHandler {
    return (_state, head) => {
        throw new Error(`Use ${mutation} for ${head.kind} choices`);
    };
}

/** Categorized legality for a `choose-categorized` submission (issue #1945) —
 *  ONE authority for both zone branches (hand: Noxious Vapors' colours;
 *  battlefield: Planar Overlay's basic land types), so the two can never
 *  drift apart, and one place that picks between `categorizedPick.ts`'s two
 *  rules off `head.categoryRule`:
 *
 *   - `"cover"` (the mandatory offer) — every non-empty category must be
 *     ANSWERED, and one member may answer several categories at once
 *     (Gatherer, Planar Overlay: "a dual land could be chosen as two of your
 *     land types"). A submission returning only the dual is legal; one that
 *     leaves a type unanswered is not.
 *   - absent (an `optional: true` offer) — the INJECTIVE rule
 *     `revealAndCategorize` uses, where each category is its own "you may".
 *
 *  Declining entirely (an empty submission) is legal exactly when the offer's
 *  own floor allows it (`count.min === 0`), which the central count check has
 *  already enforced — so the empty set short-circuits here rather than being
 *  failed by the cover rule.
 *
 *  `noun` only shapes the error text ("cards" / "permanents"). */
function assertCategorizedPickLegal(
    head: PendingChoice,
    picks: string[],
    noun: "cards" | "permanents"
): void {
    if (head.kind !== "choose-categorized" || !head.categories) return;
    if (picks.length === 0) return;
    const legal =
        head.categoryRule === "cover"
            ? isCategorizedCoverLegal(head.categories, picks)
            : isCategorizedPickLegal(head.categories, picks);
    if (legal) return;
    throw new Error(
        head.categoryRule === "cover"
            ? `Those ${noun} don't answer one category each`
            : `Those ${noun} can't each be kept for a different category`
    );
}

/** The central payload check every non-dedicated kind passes first: no
 *  duplicate ids, and a count inside the choice's `[min, max]`. */
function assertSubmissionCount(
    head: PendingChoice,
    args: SubmitChoiceArgs
): void {
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
}

/** A handler whose payload passes the central count check first. */
export function counted(handler: ChoiceSubmitHandler): ChoiceSubmitHandler {
    return (state, head, queue, args) => {
        assertSubmissionCount(head, args);
        handler(state, head, queue, args);
    };
}

/** A zone-pick handler: the count check, then every id verified against the
 *  zone the choice declares, then the kind's own application. */
export function zoned(handler: ChoiceSubmitHandler): ChoiceSubmitHandler {
    return counted((state, head, queue, args) => {
        assertZonePickLegal(state, head, args);
        handler(state, head, queue, args);
    });
}

/** Zone-level validation: verify every id exists in the declared zone. */
function assertZonePickLegal(
    state: GameState,
    head: PendingChoice,
    args: SubmitChoiceArgs
): void {
    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? args.playerId);

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
        // Categorized nomination (issue #1945, Planar Overlay — "a land of
        // each basic land type"): the BATTLEFIELD arm of the shared
        // categorized legality check. See `assertCategorizedPickLegal`.
        assertCategorizedPickLegal(head, args.cardInstanceIds, "permanents");
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
        // Categorized nomination (issue #1945, Noxious Vapors — "one card of
        // each color"): the HAND arm of the shared categorized legality
        // check. See `assertCategorizedPickLegal`.
        assertCategorizedPickLegal(head, args.cardInstanceIds, "cards");
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
            // look-distribute KEEP-pile gate (issue #1266, Narset; keepTo
            // #2070 — this gate is destination-agnostic, gating which cards
            // may be KEPT regardless of whether `keepTo` sends them to hand
            // or the library top): a looked-at card outside `eligibleIds`
            // (the "noncreature, nonland" subset) may only be bottomed —
            // never kept.
            if (
                head.kind === "look-distribute" &&
                head.eligibleIds &&
                !head.eligibleIds.includes(id)
            ) {
                throw new Error("Card is not eligible to be kept");
            }
        }
        // Categorized keep (issue #1364, Atraxa): at most one card per
        // category, and a card qualifying for several categories may be kept
        // for only ONE of them — so the hand picks are legal exactly when an
        // injective card → category assignment exists. Greedy checking is
        // unsound here (an artifact creature seated as "Creature" can strand a
        // plain creature), so this runs the same bipartite matching the client
        // gates its clicks with.
        //
        // issue #3808 — the same rule, the same module, for a CATEGORISED
        // LIBRARY pick: `search-library` (CR 701.23a — Gaea's Balance's "a
        // land card of each basic land type") and `choose-library-card`
        // (CR 701.20a — Guided Passage's "a creature card, a land card, and
        // a noncreature, nonland card", picked by an OPPONENT out of the
        // revealed library). Those picks LEAVE the library, so one card can
        // never answer two descriptions: the injective rule, never
        // `chooseCategorized`'s cover rule. Gated on the kind rather than on
        // `head.categories` alone so a future categorised kind has to come
        // here and say which rule it means.
        if (
            head.categories &&
            (head.kind === "look-distribute" ||
                head.kind === "search-library" ||
                head.kind === "choose-library-card")
        ) {
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
            // submit only the keep picks and let the rest auto-bottom in look
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
}

// ---------------------------------------------------------------------------
// Allow-list picks: the answer is not a zone member, so each kind validates
// against its own allow-list, commits the ids verbatim and resumes.
// ---------------------------------------------------------------------------

// --- "Any target" choice (CR 115.4): the pick is a damageable permanent
// OR a player (Cuombajj Witches — "1 damage to any target of an
// opponent's choice"). Players aren't in a zone, so this kind validates
// against its own allow-lists rather than the zone-membership check
// below. The single picked id is written verbatim into collectedChoices
// and the card's resolve step disambiguates permanent vs player. ---
export function submitDamageTargetPick(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    const id = args.cardInstanceIds[0];
    const playerOk = head.candidatePlayerIds?.includes(id) ?? false;
    const permanentOk = head.candidateIds?.includes(id) ?? false;
    if (!playerOk && !permanentOk) {
        throw new Error("Not a legal target");
    }
    commitChoiceAnswer(state, head, args.cardInstanceIds);
    dequeueHead(state, queue);
    resumeAfterChoice(state, {
        pendingTargetHandoff: false,
        stateBasedActions: false,
    });
}

// --- Trigger-time player pick (CR 115.1a): the pick is a player id, not a
// zone member (Endurance — "up to one target player"). Validates against
// `candidatePlayerIds`; an EMPTY submission is legal ("up to one" = none,
// `count.min === 0`). The generic min/max check above already bounds the
// count. Writes the (0- or 1-element) selection verbatim into
// collectedChoices; the card's resolve step reads it back via requestChoice
// and acts only when a player was chosen. ---
export function submitPlayerPick(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    for (const id of args.cardInstanceIds) {
        if (!(head.candidatePlayerIds?.includes(id) ?? false)) {
            throw new Error("Not a legal player");
        }
    }
    commitChoiceAnswer(state, head, args.cardInstanceIds);
    dequeueHead(state, queue);
    resumeAfterChoice(state, {
        pendingTargetHandoff: false,
        stateBasedActions: true,
    });
}

// --- Abstract option pick (CR 614.12 "as it enters, choose …"): the pick
// is one author-supplied option id, not a zone member. Validates against
// `head.options` (like `choose-damage-target` validates against its
// allow-lists) and writes the chosen id verbatim into `collectedChoices`;
// the card's resolve step reads it back via `requestOptionChoice`. ---
export function submitOptionPick(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    const id = args.cardInstanceIds[0];
    if (!head.options?.some((o) => o.id === id)) {
        throw new Error("Not a legal choice");
    }
    commitChoiceAnswer(state, head, args.cardInstanceIds);
    dequeueHead(state, queue);
    resumeAfterChoice(state, {
        pendingTargetHandoff: false,
        stateBasedActions: true,
    });
}

// --- Pick a pile (ADR 0053, pile division — step 2 of the divide-then-
// choose family): the submission is the literal label "A" or "B", not a
// zone member id. Validates against the two completed piles' labels
// (mirrors `option-pick`'s allow-list validation) and writes the chosen
// label verbatim into `collectedChoices`; `divideIntoPiles`'s resolve
// step reads it back via `requestPickPile`. ---
export function submitPilePick(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    const id = args.cardInstanceIds[0];
    if (id !== "A" && id !== "B") {
        throw new Error('Pile choice must be "A" or "B"');
    }
    commitChoiceAnswer(state, head, [id]);
    dequeueHead(state, queue);
    resumeAfterChoice(state, {
        pendingTargetHandoff: false,
        stateBasedActions: true,
    });
}

// ---------------------------------------------------------------------------
// Trigger announcement: ordering-sensitive, so these keep dedicated tails —
// the answer lands on the stack item or the off-stack batch, not in
// `collectedChoices`, and nothing resolves.
// ---------------------------------------------------------------------------

// --- Modal triggered ability's mode announcement (CR 603.3c, issue
// #2461): the submission is one mode id from the CHOOSABLE modes the
// engine offered as the trigger went on the stack. Unlike `option-pick`
// (a resolution-time answer written into `collectedChoices`) this is an
// ANNOUNCEMENT — it is written onto the stack item's `chosenModeIds`, which
// is what resolution dispatch and the stack UI read, and it is locked from
// here on (CR 700.2b — the mode is chosen as part of PUTTING the ability on
// the stack): the choice is consumed, so there is no second submission that
// could change it, and CR 700.2f keeps a later retarget from changing it
// either. The trigger's TARGETS are announced next, under this mode's
// requirement alone (CR 700.2c). ---
export function submitTriggerMode(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    const id = args.cardInstanceIds[0];
    if (!head.options?.some((o) => o.id === id)) {
        throw new Error("Not a legal mode");
    }
    const stackItem = state.stack.find((s) => s.id === head.stackItemId);
    if (!stackItem) throw new Error("Stack item not found");
    stackItem.chosenModeIds = [id];
    dequeueHead(state, queue);
    if (queue.length > 0) {
        // Another choice is still queued (a second controller's own
        // announcement): stay suspended on it rather than resuming
        // priority — the announcement sweep runs when the queue drains.
        state.priorityPlayerId = queue[0].playerId;
        return;
    }
    // Continue the CR 603.3c announcement sweep: this trigger's targets,
    // then any further trigger still owing a mode or a target. When
    // nothing is owed, the active player's priority window opens: CR 603.3b
    // ends "Then the appropriate player gets priority", once the triggers
    // are on the stack — the trigger has NOT resolved, it is on the stack.
    if (!raiseTriggerTargetSelection(state)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
    checkStateBasedActions(state);
}

// --- Trigger-order (CR 603.3b, ADR 0058): order this controller's slice of
// the off-stack simultaneous-trigger batch. The submission is a permutation
// of `candidateIds` (the slice), TOPMOST-first (index 0 = top of stack =
// resolves first). Reorder the slice within `pendingTriggerBatch`; when the
// last `trigger-order` choice clears, push the whole batch onto the stack in
// one shot (bottom-first, APNAP-grouped) and hand priority to the active
// player (CR 117.3c). Held off-stack until then, so the stack is never
// observed half-ordered. ---
export function submitTriggerOrder(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    const sliceIds = head.candidateIds ?? [];
    const submitted = args.cardInstanceIds;
    if (
        submitted.length !== sliceIds.length ||
        new Set(submitted).size !== submitted.length ||
        !submitted.every((id) => sliceIds.includes(id))
    ) {
        throw new Error("Trigger order must be a permutation of your triggers");
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
    // player's priority window. Despite its name the same call also runs
    // the CR 603.3c MODE announcement first (issue #2461).
    if (!raiseTriggerTargetSelection(state)) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
    }
    checkStateBasedActions(state);
}

// ---------------------------------------------------------------------------
// Turn-structure picks: answered outside any resolution, each by its own
// phase-level finalizer.
// ---------------------------------------------------------------------------

/** The London mulligan's bottom pick (`applyMulliganBottomChoice`). */
export function submitMulliganBottom(
    state: GameState,
    _head: PendingChoice,
    _queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
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
}

// CR 502.1: additional untap-pick constraints beyond zone validation.
export function submitUntapPick(
    state: GameState,
    head: PendingChoice,
    _queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? args.playerId);
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
}

// CR 614 (Aladdin's Lamp) — phase-level draw replacement. The reorder +
// draw + priority resumption live in `finalizeDrawLookKeep`.
export function submitDrawLookKeep(
    state: GameState,
    _head: PendingChoice,
    _queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    finalizeDrawLookKeep(state, args.cardInstanceIds);
}

/** `legend-keep` is the SBA-level keep-one when stackless, else an ordinary
 *  mid-resolution pick. */
export function submitLegendKeep(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    if (head.stackItemId !== "") {
        submitMidResolutionPick(state, head, queue, args);
        return;
    }
    // CR 704.5j (#378) — SBA-level keep-one. The submission must be exactly
    // one of the recorded same-name duplicates; the battlefield zone check
    // above already verified it is on the chooser's battlefield. The
    // graveyard moves, queue shift, SBA re-sweep, and priority resumption
    // live in `finalizeLegendKeep`.
    if (!head.candidateIds?.includes(args.cardInstanceIds[0])) {
        throw new Error("Card is not an eligible choice");
    }
    finalizeLegendKeep(state, args.cardInstanceIds);
}

/** `discard-hand` is the phase-level cleanup discard when stackless during
 *  cleanup, else an ordinary mid-resolution pick. */
export function submitDiscardHand(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    if (head.stackItemId === "" && state.pendingCleanupDiscard) {
        // CR 514.1 phase-level cleanup discard. `finalizeCleanupDiscard`
        // handles the move, queue shift, CR 514.2 cleanup, and phase
        // advancement.
        finalizeCleanupDiscard(state, args.cardInstanceIds);
        return;
    }
    submitMidResolutionPick(state, head, queue, args);
}

// ---------------------------------------------------------------------------
// The generic mid-resolution tail every zone-pick kind returns into.
// ---------------------------------------------------------------------------

// Mid-resolution choice (CR 608.2): write picks into the stack item's
// `collectedChoices` so the next invocation of the resolve step reads
// them back via `requestChoice`.
export function submitMidResolutionPick(
    state: GameState,
    head: PendingChoice,
    queue: PendingChoice[],
    args: SubmitChoiceArgs
): void {
    const key = `${head.step}:${head.choiceId}`;
    commitChoiceAnswer(
        state,
        head,
        args.cardInstanceIds,
        // `order-top` / `look-distribute` carry a SECOND ordered list under a
        // sibling key; `SpellContext.orderTop` / `lookDistribute` read it back on
        // resume to apply the destination split.
        head.kind === "order-top" || head.kind === "look-distribute"
            ? { [`${key}:second`]: args.secondZoneIds ?? [] }
            : {}
    );

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

    // CR 701.23a / 603.2 (issue #788) — a `search-library` choice commits
    // exactly when the player finishes searching, whether or not they found
    // anything (a fetchland whiff still "searched"). This is the single
    // choke point every tutor/fetchland library search funnels through
    // regardless of DSL-vs-resolve() authoring — see
    // `emitLibrarySearchedEvent`'s doc comment. The SEARCHER is derived from
    // the CHOICE, not the stack item: `head.actingPlayerId ?? head.playerId`.
    // `head.playerId` is who the prompt is addressed to — for Path to
    // Exile/Erode-shaped effects (`ctx.requestChoice({ playerId:
    // controllerId })` with the TARGET's controller and no `zoneOwnerId`)
    // that is the searcher, distinct from the stack item's controller. Under
    // ADR 0037 Word-of-Command acting-player routing, `head.actingPlayerId`
    // carries the CONTROLLED player when the prompt itself is redirected to
    // the WoC controller (`state.ts:13161-13167`), so it — not the stack
    // item's `controllerId`/`castById` — is who "searches" in that case too.
    // Reading off the stack item was tried and reverted: `controllerId` is
    // not the engine's canonical stack-item controller (`castById` is —
    // `buildSpellContext` sets `controller: item.castById`,
    // `state.ts:9534`; `removeFromZone` leaves a stale `controllerId` on
    // cross-player casts like Dauthi Voidwalker), and using it made the
    // opponent-searches-your-library case (Path to Exile/Erode) wrongly
    // suppress. The LIBRARY OWNER is `head.zoneOwnerId ?? head.playerId` —
    // the two are equal for the ordinary "target player searches their own
    // library" case (self-tutor, Path/Erode's "you exile target creature,
    // its controller searches their OWN library" — no `zoneOwnerId`, so it
    // falls back to `head.playerId`, the same person), but DIFFER for a
    // Jester's Cap/Jester's Mask/Lobotomy-shaped "search TARGET PLAYER's
    // library" (bugfix, post-review): there the prompted player is the
    // searcher while a DIFFERENT player (`zoneOwnerId`) owns the library,
    // and a single collapsed field wrongly let the searcher's own "whenever
    // an opponent searches their library" trigger fire off a search of an
    // OPPONENT's library. `librarySearchedTrigger`'s scope gate requires the
    // two fields to be equal before applying scope, so this cross-library
    // shape never fires.
    // `search-library` is overloaded: Expressive Iteration (stx/multicolor.ts)
    // and Diabolic Vision (ice/multicolor.ts) reuse the SAME PendingChoice
    // `kind` for a "look at the top N, pick one" prompt, which is NOT a CR
    // 701.23a search (that requires looking at the WHOLE zone) — gating on
    // `kind` alone fires a false `LIBRARY_SEARCHED` for both. `isSearch` is
    // the explicit, fail-closed discriminator set only at genuine raise sites
    // (see `PendingChoice.isSearch`); a choice persisted before this field
    // existed has `isSearch === undefined` and correctly fails closed (no
    // spurious trigger) rather than open.
    if (head.kind === "search-library" && head.isSearch) {
        emitLibrarySearchedEvent(
            state,
            head.actingPlayerId ?? head.playerId,
            head.zoneOwnerId ?? head.playerId
        );
    }

    // CR 701.23b / 400.2 (issue #3425) — a genuine library search that came
    // back with NOTHING is announced to every player. The library is a Hidden
    // Zone, so no zone projection can carry the outcome, and CR 701.23b makes
    // finding nothing a legal CHOICE rather than a proof the card was absent:
    // without an explicit signal, a search that found nothing and a tutor that
    // found exactly what it wanted are the same observation to the opponent —
    // a choice appeared and went away.
    //
    // WHICH searches can report a DELIBERATE whiff is a separate, older
    // question: about half the shipped `search-library` Ops declare a fixed
    // `count` (every fetchland, Demonic Tutor, Entomb), so their prompt can
    // only come back empty when the library holds no match at all, and CR
    // 701.23b's "isn't required to find" is not modelled for them. That is not
    // this seam's to fix — the announcement is identical either way — and it
    // is drafted in `docs/findings/`.
    //
    // Gated on the SAME `isSearch` discriminator `emitLibrarySearchedEvent`
    // uses, so the look-pick prompts that merely reuse the `search-library`
    // kind (Expressive Iteration, Diabolic Vision) never announce, and a choice
    // persisted before that field existed fails CLOSED. Both the DSL `choice`
    // Op's zero-hit search (which still raises a 0-pick prompt so the player
    // gets their CR 701.23a look) and an imperative `resolve()` tutor funnel
    // through here, so this covers every shipped search with no per-card wiring.
    //
    // DEFERRED past the resolution below, not enqueued here: this same function
    // is about to call `resolveTopOfStack`, whose first act is to clear
    // `pendingReveals` for the incoming resolution — an entry written now would
    // be wiped before any client saw it. The source card id is read HERE, while
    // the searching item is still identifiable on the stack.
    const failToFind =
        head.kind === "search-library" &&
        head.isSearch === true &&
        args.cardInstanceIds.length === 0
            ? {
                  stackItemId: head.stackItemId,
                  step: head.step,
                  choiceId: head.choiceId,
                  // The head's stack item is guaranteed present — this
                  // function already threw on a missing one long before here.
                  source:
                      (
                          state.stack.find((i) => i.id === head.stackItemId)!
                              .card as { id?: string }
                      ).id ?? "",
              }
            : undefined;

    dequeueHead(state, queue);
    resumeAfterChoice(state, {
        pendingTargetHandoff: false,
        stateBasedActions: false,
    });

    // Enqueued LAST so the `resolveTopOfStack` above (which clears
    // `pendingReveals` on entry) cannot wipe it. It therefore rides the same
    // stable snapshot as any reveal the resumed resolution produced, and the
    // client's one-at-a-time overlay shows the newest first — which for a
    // fail-to-find is the whole outcome of that search.
    if (failToFind !== undefined) enqueueFailToFindNotice(state, failToFind);
}
