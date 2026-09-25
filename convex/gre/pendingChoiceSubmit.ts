// Atomic, client-buffered submission of a mid-resolution PendingChoice
// (CR 608.2, 101.4). Replaces the per-click `selectResolutionChoice` server
// accumulation for kinds that have been migrated. See ADR 0007.

import {
    getPendingChoiceMax,
    getPendingChoiceMin,
    canPayMayPayCost,
    payMayPayCost,
    getMayPaySacrificeCandidateIds,
    mayPaySacrificeChoiceRequired,
    mayPaySacrificeThreshold,
    mayPaySacrificeSetPower,
    getMayPayDiscardCandidateIds,
    mayPayDiscardChoiceRequired,
    mayPayHandLegCount,
    mayPayHandSelectionLegal,
    normalizeMayPayCost,
    numberChoiceRange,
    findStagedEntry,
    type GameState,
    type PendingChoice,
} from "./state";
import { handCardMatchesFilter } from "./alternativeCost";
import { writeTaggedNumber } from "./numberBinding";
import { hasName as isChooseableName } from "../cards/cardNames";
import type { CardDefinition, EffectCardFilter } from "../cards/types";
import { finalizeAsEnters } from "./asEnters";
import { checkStateBasedActions } from "./sba";
import { tryGetCardByName } from "../cards";
import { finalizeLandEntry } from "./playLand";
import {
    commitChoiceAnswer,
    dequeueHead,
    handPriorityOn,
    resumeAfterChoice,
    type ResumeOptions,
} from "./pendingChoiceResume";
import { pendingChoiceHandlerFor } from "./pendingChoiceHandlers";

/** The epilogue the dedicated-mutation kinds return into: a resumed
 *  resolution may raise a copy-retarget, and SBAs are swept after it. */
const RESUME_WITH_RETARGET: ResumeOptions = {
    pendingTargetHandoff: true,
    stateBasedActions: true,
};

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
    /** CR 701.21a — the payer's chosen sacrifice victim id(s) for a may-pay
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
        // CR 701.21a / 400.7 — validate the payer's permanent pick when the
        // leg admits a real choice. The candidate set is recomputed live (the board may have
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
                const need = norm.permanent!.count as number;
                if (ids.length !== need) {
                    throw new Error(
                        norm.permanent!.action === "return"
                            ? `Must choose ${need} permanent(s) to return`
                            : `Must choose ${need} permanent(s) to sacrifice`
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
            const need = mayPayHandLegCount(head.cost);
            if (ids.length !== need) {
                throw new Error(`Must choose ${need} card(s) to discard`);
            }
            // CR 118.9 — the candidate check above is per-CARD (does SOME
            // requirement admit it); this is per-LEG: the picked cards together
            // must cover EVERY requirement from distinct cards. Without it a
            // filtered / multi-requirement leg accepts a count-correct pick the
            // pay path would then quietly reassign.
            if (
                !mayPayHandSelectionLegal(state, args.playerId, head.cost, ids)
            ) {
                throw new Error("Illegal discard choice");
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
    commitChoiceAnswer(state, head, answer);
    dequeueHead(state, queue);
    resumeAfterChoice(state, RESUME_WITH_RETARGET);
}

export type SubmitLandEntryArgs = {
    playerId: string;
    accept: boolean;
};

/** Validates and applies a `land-entry-tapped` submission (CR 614.12, ADR 0051)
 *  against the current head pending choice — the shock-land pay-choice. On
 *  accept the cost is paid (gated by `canPayMayPayCost`; throws if unaffordable)
 *  to skip the land's own tapped clause; either way `finalizeLandEntry`
 *  completes the suspended entry (moving the land from whichever zone the
 *  choice's `landSourceZone` names onto the battlefield, tapped iff declined
 *  OR forced by another source). Unlike `applyMayPaySubmit`
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

    dequeueHead(state, queue);

    finalizeLandEntry(
        state,
        args.playerId,
        head.landInstanceId,
        head.cost,
        args.accept,
        // issue #1980 — the choice's own source-zone discriminator, read off
        // `head` before the shift above; without it the finalizer cannot find
        // a land suspended in exile or a graveyard.
        head.landSourceZone,
        // CR 712.12 — the face the play chose, read off the same choice for
        // the same reason: the entry has to finish on the face the player
        // named, and a `land // land` pathway has two legal answers.
        head.landEntryFace
    );

    // CR 614.12 — a played land is not a stack resolution; resume priority to
    // the active player (any ETB triggers `settleEnteredLand` pushed sit on the
    // stack for that window), then settle SBAs. If somehow another choice was
    // enqueued during finalize, hand priority to its chooser.
    handPriorityOn(state, false);
    checkStateBasedActions(state);
}

export type SubmitNameCardArgs = {
    playerId: string;
    cardName: string;
};

/** CR 201.4a — the two printed name restrictions. `"no-basic-land"` is
 *  Desperate Research's "choose a card name other than a basic land card name"
 *  (issue #1085): a basic land CARD, not merely a land with a basic land TYPE
 *  — checked against the printed characteristics, mirroring every other
 *  registry-backed name restriction in this pipeline. `"no-land"` (issue
 *  #2713) is Cabal Therapy's stronger "a nonland card name": EVERY land is
 *  rejected, so it subsumes the basic-land case.
 *
 *  The single authority both doors read: the `submitNameCard` mutation and the
 *  bot's `isLegalNamedCard`, so a bot answer is legal by construction rather
 *  than by luck (issue #2497 — a rejected name is a frozen game, not a retry). */
function violatesNameRestriction(
    head: PendingChoice,
    def: CardDefinition
): boolean {
    if (!def.types.includes("Land")) return false;
    if (head.nameRestriction === "no-land") return true;
    return (
        head.nameRestriction === "no-basic-land" &&
        (def.supertypes?.includes("Basic") ?? false)
    );
}

/** CR 614.1c — the filter an as-enters `{ kind: "name", filter }` head declares
 *  (Meddling Mage's "choose a nonland card name"), or `undefined` when the head
 *  is unfiltered or is an ordinary mid-resolution `name-card`.
 *
 *  Read off the STAGED entry's own owed head, so the card definition stays the
 *  single source and no copy of the filter has to ride the prompt (PR #2496).
 *  Typed on the structural slice it reads rather than the whole `GameState`, so
 *  the client-side Brain resolves the identical filter from its projected
 *  `PublicGameState` (ADR 0074, issue #2497). */
export function asEntersNameFilter(
    state: Pick<GameState, "stagedEntries">,
    head: PendingChoice
): EffectCardFilter | undefined {
    if (head.stackItemId !== "" || head.asEntersCardId === undefined) {
        return undefined;
    }
    const owed = findStagedEntry(state, head.asEntersCardId)?.owed[0];
    return owed?.kind === "name" ? owed.filter : undefined;
}

/** CR 201.3 / 614.1c — is `name` a LEGAL answer to this `name-card` head?
 *
 *  THE single authority on that question: {@link applyNameCardSubmit} rejects
 *  exactly what this returns `false` for, and the bot's default picker
 *  (`nameCardDefaultFor`, `src/lib/ai/bot-view.ts`) only ever offers a name
 *  this returns `true` for. Sharing the predicate is what makes the bot's
 *  rung-2 submission legal BY CONSTRUCTION rather than by luck — and that
 *  matters more here than at any other window, because `ESCALATION_POLICY`
 *  gives the `choice` Expected Input kind no rung BELOW the minimal-legal
 *  submission (CR 608.2 provides no decline for a mid-resolution choice). A
 *  second, parallel copy of these rules would let picker and check drift, and
 *  a drift there is a frozen game, not a bad play (ADR 0047, #2283/#2497).
 *
 *  Bounded by what {@link handCardMatchesFilter} enforces: that shared matcher
 *  reads 10 of `EffectCardFilter`'s fields and returns `true` for the rest, so a
 *  filter declaring only `excludeSupertype` / `excludeColor` / `manaValueEquals`
 *  / `hasAbility` is inert on BOTH sides — picker and check stay in agreement
 *  precisely because they fail open together. */
export function isLegalNamedCard(
    state: Pick<GameState, "stagedEntries">,
    head: PendingChoice,
    name: string
): boolean {
    const def = tryGetCardByName(name.trim());
    if (!def) return false;
    if (!isChooseableName(def, def.name)) return false;
    if (violatesNameRestriction(head, def)) return false;
    const filter = asEntersNameFilter(state, head);
    return (
        filter === undefined ||
        handCardMatchesFilter({ card: { id: def.id } }, filter)
    );
}

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
    // CR 709.4a (ADR 0121) — "if an effect instructs a player to choose a card
    // name and the player wants to choose a split card's name, the player must
    // choose one of those names and NOT BOTH." `tryGetCardByName` resolves the
    // combined string to the parent definition — it is a lookup key, and deck
    // lists, cubes and banlists need it — but it is not a name anyone may
    // CHOOSE. Rejected here and in `isLegalNamedCard` above so the gate and
    // the client's candidate list (`getChooseableCardNames`) agree; a server
    // that accepted a name the button never offered is the asymmetry PR #3302
    // review finding 4 closed for Adventure, in the other direction.
    if (!isChooseableName(def, canonical)) {
        throw new Error(
            "Choose one of the card's two names, not both (CR 709.4a)"
        );
    }
    // CR 201.4a (issue #1085 / #2713) — "a card name with certain
    // characteristics". Routed through the shared predicate so the bot's
    // default picker cannot disagree with this check (#2497); the message
    // is derived from the head's own restriction, so Cabal Therapy does not
    // tell the player the basic-land rule it is not enforcing.
    if (violatesNameRestriction(head, def)) {
        throw new Error(
            head.nameRestriction === "no-land"
                ? "Choose a nonland card name"
                : "Choose a card name other than a basic land card name"
        );
    }

    // CR 614.1c (ADR 0100 D3/D5) — the as-enters `name` kind REUSES this same
    // `name-card` shape, but its prompt is STACKLESS (`stackItemId: ""`): there
    // is no stack item to commit the answer into, and the finalize writes the
    // name onto the staged permanent itself (`applyAsEntersAnswer`). Routed
    // here, not only in `applyPendingChoiceSubmit`, because EVERY client and
    // bot path for a `name-card` head lands in this function — the
    // `submitNameCard` mutation, and `legalActions`' `submit-name-card` →
    // `brain.decideBotAction` → the same mutation. A branch that existed only
    // over there would leave both throwing `Stack item not found` on a choice
    // nobody can answer: the ADR 0047 / #2283 freeze shape.
    if (head.stackItemId === "" && head.asEntersCardId !== undefined) {
        // CR 614.1c — the as-enters `name` kind may DECLARE a filter narrowing
        // the legal name space (Meddling Mage's "choose a nonland card name").
        // `asEntersNameFilter` reads it off the staged entry's own owed head,
        // so the card definition stays the single source and no copy of the
        // filter has to ride the prompt. A name the filter rejects throws here
        // — beside the `nameRestriction` check above and before anything is
        // committed — so the chooser is asked again rather than the filter
        // being ignored. `handCardMatchesFilter` is the shared
        // registry-definition matcher (it is typed on the definition id it
        // reads, not on a hand card), so this is the same matcher the alt-cost
        // hand leg and `discardFilter` use rather than a third copy — which
        // also bounds what this check enforces: the matcher reads 10 of
        // `EffectCardFilter`'s fields and returns `true` for the rest, so a
        // filter declaring only `excludeSupertype` / `excludeColor` /
        // `manaValueEquals` / `hasAbility` is inert here. Widening the shared
        // matcher is out of scope for this seam (it has other callers); #2467,
        // which ships the first filtered card, is where those fields earn
        // their handling.
        const filter = asEntersNameFilter(state, head);
        if (
            filter !== undefined &&
            !handCardMatchesFilter({ card: { id: def.id } }, filter)
        ) {
            throw new Error("Not a legal card name for this choice");
        }
        finalizeAsEnters(state, [canonical]);
        return;
    }

    head.chosenName = canonical;
    commitChoiceAnswer(state, head, [canonical]);

    dequeueHead(state, queue);
    resumeAfterChoice(state, RESUME_WITH_RETARGET);
}

export type SubmitNumberChoiceArgs = {
    playerId: string;
    /** The nominated amount (CR 107.1b / 107.3f). Non-negative integer,
     *  re-validated here against the choice's LIVE range — never trusted. */
    amount: number;
};

/** Validates and applies a `number-pick` submission (CR 107.1b / 107.3f, issue
 *  #1701) against the current head pending choice. The amount must be a
 *  non-negative integer inside {@link numberChoiceRange} — for a `paysMana`
 *  nomination that ceiling is the payer's LIVE spendable pool, recomputed here
 *  rather than read off the entry, because the chooser may have activated mana
 *  abilities while the prompt was open (CR 605.3a).
 *
 *  When the choice pays, the amount is spent as a GENERIC mana leg through the
 *  same `canPayMayPayCost` / `payMayPayCost` path every other may-pay leg uses
 *  (same `ManaRestriction` handling, same "lands must already be tapped" rule)
 *  — one payment authority, not a second one for this family. Amount 0 pays
 *  nothing and IS the decline (CR 107.3f — paying {X} with X = 0 and declining
 *  are game-observably identical), so it is always legal and needs no separate
 *  flag.
 *
 *  On success the amount is committed into the stack item's `collectedChoices`
 *  as a TAGGED numeric binding so the resolve step reads it back via
 *  `requestNumberChoice` and a later Op reads it as an `EffectValue` `ref`.
 *  Mutates `state` in place. Throws on identity mismatch, a non-`number-pick`
 *  head, or an out-of-range / unpayable amount. Mirrors `applyMayPaySubmit` so
 *  the mutation and the bot's headless resolution path drive the SAME
 *  primitive. */
export function applyNumberChoiceSubmit(
    state: GameState,
    args: SubmitNumberChoiceArgs
): void {
    const queue = state.pendingChoices ?? [];
    if (queue.length === 0) throw new Error("No pending choice");
    const head = queue[0];
    if (head.kind !== "number-pick") {
        throw new Error("Pending choice is not a number pick");
    }
    if (head.playerId !== args.playerId) {
        throw new Error("Not your pending choice");
    }
    if (!Number.isInteger(args.amount) || args.amount < 0) {
        throw new Error("Choose a non-negative whole number");
    }
    const payer = state.players.find((p) => p.id === args.playerId);
    const range = numberChoiceRange(head, payer);
    // A below-floor answer is reported as a FLOOR violation (issue #1421): an
    // open-ended nomination's ceiling is the engine cap `MAX_CHOSEN_NUMBER`,
    // and naming it in a message about a minimum would send the author looking
    // at the wrong end of a range CR 107.1c does not really have.
    if (args.amount < range.min) {
        throw new Error(`Choose a number of at least ${range.min}`);
    }
    if (args.amount > range.max) {
        throw new Error(
            `Choose a number between ${range.min} and ${range.max}`
        );
    }
    if (head.paysMana && args.amount > 0) {
        // CR 107.3f / 118.4 — the nomination is paid as GENERIC mana through
        // the shared may-pay payment path. The range check above already
        // bounds it by the spendable pool; this is the same all-or-nothing
        // gate every may-pay leg passes, so the two can never disagree about
        // what "affordable" means (substitutions, CR 106.6 restricted mana).
        const cost = { mana: { generic: args.amount } };
        if (
            !canPayMayPayCost(state, args.playerId, cost, head.manaRestriction)
        ) {
            throw new Error("Cannot pay the mana cost from your mana pool");
        }
        payMayPayCost(state, args.playerId, cost, head.manaRestriction);
    }

    commitChoiceAnswer(state, head, writeTaggedNumber(args.amount));

    dequeueHead(state, queue);
    resumeAfterChoice(state, RESUME_WITH_RETARGET);
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
    dequeueHead(state, queue);
    resumeAfterChoice(state, RESUME_WITH_RETARGET);
}

/** Validates and applies a client-buffered submission against the current
 *  head pending choice. Mutates `state` in place. Throws on validation
 *  failure (identity mismatch, may-pay kind, duplicate ids, count outside
 *  `[min, max]`, ids not in the chooser's zone). Each thrown message is
 *  user-facing — the client surfaces it via a transient toast (ADR 0007).
 *  Handles all zone-pick kinds; the kinds with their own mutation (`may-pay`,
 *  `name-card`, `land-entry-tapped`, `number-pick`, `random-reveal`,
 *  `madness-cast`, `rebound-cast`, `draw-replacement`) are rejected here. */
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

    // --- As-enters choice (CR 614.1c / 614.12a, ADR 0100 D5) — the FIFTH
    // early-return finalize. Discriminated on the explicit `asEntersCardId`
    // rather than on `kind`: every as-enters prompt REUSES an existing
    // `PendingChoiceKind` shape (`option-pick`, `choose-permanents`,
    // `choose-aura-host`, `name-card`), so `kind` alone cannot tell one from an
    // ordinary mid-resolution choice, and an implicit "it's stackless, so it
    // must be as-enters" invariant would fail open the moment another stackless
    // family reuses the same shape. Placed ABOVE the generic validation because
    // the staged permanent is in NO zone: a zone-membership check has nothing to
    // check against, and `name-card` would be bounced to its own mutation. This
    // branch therefore does its own validation, then hands off to the shared
    // finalize, which reproduces (never reaches) the generic tail. ---
    if (head.asEntersCardId !== undefined && head.stackItemId === "") {
        // `name-card` has its own mutation (`submitNameCard`) — reject here
        // too. This branch sits ABOVE the generic `name-card` rejection below,
        // so without this line it is a SECOND door into the same write: an
        // as-enters `name` head has `count: 1`, no `candidateIds` and no
        // `options`, so the validation that follows admits ANY string and
        // `finalizeAsEnters` writes it straight to `chosenName` — bypassing
        // `applyNameCardSubmit`'s CR 201.2 registry lookup, its
        // `nameRestriction` check and the `filter` check. Same shape and
        // message as the rejection below so the two doors read as one rule.
        if (head.kind === "name-card") {
            throw new Error("Use submitNameCard for name-card choices");
        }
        const min = getPendingChoiceMin(head.count);
        const max = getPendingChoiceMax(head.count);
        if (
            new Set(args.cardInstanceIds).size !== args.cardInstanceIds.length
        ) {
            throw new Error("Duplicate ids in submission");
        }
        if (args.cardInstanceIds.length < min) {
            throw new Error(
                min === 1 ? "Select at least 1 card" : `Select at least ${min}`
            );
        }
        if (args.cardInstanceIds.length > max) {
            throw new Error(
                max === 1 ? "Select at most 1 card" : `Select at most ${max}`
            );
        }
        // `candidateIds` / `options` are the authoritative allow-lists — the
        // staged permanent's choice is offered against a set computed at prompt
        // time (legal Aura hosts, copiable permanents, payable life amounts),
        // and `name-card` is free text with no allow-list at all.
        for (const id of args.cardInstanceIds) {
            if (head.candidateIds && !head.candidateIds.includes(id)) {
                throw new Error("Card is not an eligible choice");
            }
            if (head.options && !head.options.some((o) => o.id === id)) {
                throw new Error("Not a legal choice");
            }
        }
        finalizeAsEnters(state, args.cardInstanceIds);
        return;
    }

    pendingChoiceHandlerFor(head.kind).submit(state, head, queue, args);
}
