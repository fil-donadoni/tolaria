// Headless bot-vs-bot game loop (ADR 0001 self-play harness). Plays a full game
// to its natural end (life / decked) with NO Convex runtime: both seats are
// driven by the SAME production decision stack the live bot uses —
//
//   * decision nodes (priority, land/spell/ability, attack/block, mulligan
//     keep-or-mull) → `search` (ISMCTS), applied via `applyMoveInSearch`;
//   * resolution nodes (discard / scry / sacrifice / may-pay / mulligan-bottom)
//     → the SAME default policy as live play (`chooseResolution`, ADR 0016),
//     applied via the engine-side resolvers `applyPendingChoiceSubmit` /
//     `applyMayPaySubmit`.
//
// Fidelity: this is the same code the server would run, minus Convex
// orchestration (scheduler / persistence). The harness measures the engine's
// own play quality, so any divergence here would bias the metric. Documented v1
// simplifications (flagged, not hidden):
//   * may-pay: accept a COSTLESS "may" (always affordable), decline a costed one
//     — the headless bot does not pre-tap lands, so accepting a costed may-pay
//     can't be paid. Rare in the preset decks; revisit with real mana planning.
//   * mid-ANNOUNCEMENT target selection (a `"cast"` / `"ability"` pending
//     target) is still not driven here — it belongs to the executor's atomic
//     announcement sequence, which the headless loop does not run. The
//     ENGINE-RAISED kinds (`"trigger"` / `"retarget"` / `"copy-retarget"`) ARE
//     driven since issue #2283: `decidingPlayer` names their owner and
//     `enumerateMoves` surfaces the legal submissions, so a targeted trigger no
//     longer ends the game with `"stall"` / `"resolution-error"`.

import {
    search,
    applyMoveInSearch,
    decidingPlayer,
    enumerateMoves,
    materialMargin,
    cardValueById,
    getPlayer,
    matchesPermanentFilter,
    getPendingChoiceMin,
    getPendingChoiceMax,
    makeRng,
    type GameState,
    type PendingChoice,
    type CardInstanceState,
    type SearchBudget,
} from "@convex/gre";
import {
    applyPendingChoiceSubmit,
    applyMayPaySubmit,
    applyNameCardSubmit,
    recordDeclaration,
} from "@convex/gre";
import {
    computeExpectedInput,
    type ExpectedInputKind,
} from "@convex/gre/expectedInput";
import { manaValue } from "@convex/gre/constants";
import { effectivePermanentView } from "@convex/gre/permanentView";
import { getCardColorIdentity, getColorsFromCost } from "@convex/cards/colors";
import { tryGetDefinition } from "@convex/cards";
import {
    chooseResolution,
    type ManaSituation,
    type OwedChoice,
} from "../brain";

/** Why a game ended. `stall` / `max-plies` / `resolution-error` /
 *  `search-error` are harness guards, not real MTG outcomes — they surface a
 *  bug or an unsupported case rather than a legitimate win, and are reported
 *  separately so they never silently inflate a win-rate. */
export type GameEndReason =
    | "life"
    | "decked"
    | "concede"
    | "draw"
    | "poison"
    | "alternate-win"
    | "stall"
    | "max-plies"
    | "resolution-error"
    | "search-error";

export type GameResult = {
    /** Seat id that won, or null for a non-terminal stop (guard reasons). */
    winnerId: string | null;
    loserId: string | null;
    reason: GameEndReason;
    /** Game turn number reached (CR 500-style turn counter). */
    turns: number;
    /** Total decision+resolution steps applied (work done). */
    plies: number;
    /** Final material margin from seat A's perspective (signed; + = A ahead).
     *  Saturation-proof (`materialMargin`), so it stays informative even after a
     *  terminal life swing. */
    marginA: number;
    /** The Expected Input kind (ADR 0047) the game was resting on when a guard
     *  reason fired — `stall` / `resolution-error` (issue #2284). Headless
     *  self-play inherits the liveness invariant: an UNDRIVEN window must fail
     *  loudly, naming the window nobody handled, instead of disappearing into a
     *  generic reason string. `undefined` for a real MTG outcome. */
    unhandledExpectedInput?: ExpectedInputKind;
};

export type SeatConfig = {
    id: string;
    budget: SearchBudget;
};

/** The per-decision search entry point. Defaults to the production `search`;
 *  injectable so a test can drive the `search-error` guard without a crashing
 *  card (mirrors how `resolvePending` failures are exercised). */
type SearchFn = typeof search;

const MAX_PLIES = 4000;

/** List the legal candidate instances for a zone-pick choice, honoring the
 *  precomputed allow-list (`candidateIds`) when present, else the declared zone
 *  (+ battlefield filter). Mirrors the zone-membership logic the resolver
 *  validates against, so the picked ids are always legal.
 *  Exported for `playGame.bot.test.ts` — a direct unit test on the mechanism
 *  the issue #2689 fixup 2 review found broken, rather than exercising it only
 *  indirectly through a full self-play game. */
export function listCandidates(
    state: GameState,
    head: PendingChoice
): CardInstanceState[] {
    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? head.playerId);

    // `hand` / `library` / `graveyard` / `exile` (`PendingChoice.zone`,
    // gre/state.ts) are all simple owner-zone picks with the SAME
    // resolver contract (`pendingChoiceSubmit.ts`): the pool is the owner's
    // zone, intersected with `candidateIds` (the allow-list snapshotted when
    // the choice was raised) when one is present. Collapsed into one branch
    // (issue #2689 fixup 3 review) so a fifth zone added to the union does
    // not need a fourth copy of this body the way `exile` did —
    // `choose-exile-card` (Dauthi Voidwalker, interpreter.ts's exile branch;
    // Currency Converter's hand-built `requestChoice`) always carries a
    // non-empty `candidateIds` and hit the untagged-zone throw below.
    // `battlefield` stays its own branch: it has `allControllers`, a
    // type/controller filter and its own chooser-relative semantics that
    // don't fit this shape.
    //
    // NOT a compile-time exhaustiveness guarantee (#2689 round-3 review):
    // this tuple has no `satisfies` tie to the union and no `never` default,
    // so a SIXTH zone added to `PendingChoice.zone` compiles silently. What
    // catches it is the untagged-zone throw below, and only when
    // `candidateIds` is non-empty; raised without one it still returns `[]`
    // and surfaces downstream as a generic "Select at least 1 card". A real
    // guarantee needs a `switch` with `const _never: never = head.zone`.
    const SIMPLE_OWNER_ZONES = [
        "hand",
        "library",
        "graveyard",
        "exile",
    ] as const;
    if (
        head.zone &&
        (SIMPLE_OWNER_ZONES as readonly string[]).includes(head.zone)
    ) {
        const zone = head.zone as (typeof SIMPLE_OWNER_ZONES)[number];
        const pool = zoneOwner[zone];
        const allowListed = head.candidateIds
            ? pool.filter((c) => head.candidateIds!.includes(c.id))
            : pool;
        // `eligibleIds` (library `look-distribute` only — gre/state.ts;
        // no CR keyword action governs it, it is an ordinary effect's
        // restriction on which looked-at cards may be KEPT) narrows
        // further: the full looked-at
        // window is shown, but the submit-validator
        // (pendingChoiceSubmit.ts) rejects any KEPT id outside it, only for
        // `zone === "library"` and `kind === "look-distribute"`. Without
        // this conjunct the default policy could pick an unkeepable card
        // and guard-stop on "Card is not eligible to be kept" (issue #2689
        // fixup 3 review, medium finding — same fail-open shape as the
        // `candidateIds` bug this branch was collapsed to fix).
        if (zone === "library" && head.eligibleIds) {
            return allowListed.filter((c) => head.eligibleIds!.includes(c.id));
        }
        return allowListed;
    }
    if (head.zone === "battlefield") {
        const pool = head.allControllers
            ? state.players.flatMap((p) => p.battlefield)
            : zoneOwner.battlefield;
        const filtered = head.filter
            ? pool.filter((c) =>
                  // Issue #1209 — the layered view, never the raw instance:
                  // `colors` / effective P-T / the turn-scoped flags are all
                  // DERIVED, so a raw instance makes those clauses fail CLOSED
                  // and the pool goes silently empty. Mirrors the live bot's
                  // `projectedPermanentView` (`src/lib/ai/bot-view.ts`).
                  matchesPermanentFilter(
                      effectivePermanentView(state, c),
                      head.filter!,
                      {
                          // CR 701.21 (issue #1938 fixup 2) — resolves
                          // `controllerRelation` ("sacrifice two Swamps YOU
                          // control") against the CHOOSER. Without this the
                          // filter fails CLOSED, the candidate pool goes empty
                          // even though `head.candidateIds` (intersected
                          // below) already lists legal picks, and the headless
                          // bot can't enumerate a move for the pick.
                          selfControllerId: head.playerId,
                      }
                  )
              )
            : pool;
        return head.candidateIds
            ? filtered.filter((c) => head.candidateIds!.includes(c.id))
            : filtered;
    }
    if (head.kind === "trigger-order") {
        // CR 603.3b — `candidateIds` here are STACK ITEM ids (a permutation
        // to order), never permanent instance ids; `resolvePending` reads
        // `head.candidateIds` directly for its submission and never consults
        // this function's return for this kind (the mapped `candidates` list
        // built from it is discarded). Filtering against the battlefield
        // would misfire the untagged-zone diagnostic below on every such
        // choice, so this kind is out of scope for it by construction.
        return [];
    }
    // No zone (e.g. `choose-damage-target`, whose every construction sets
    // `zone: "battlefield"` in practice, so this is truly the fallback for an
    // UNANTICIPATED zone-less permanent pick): fall back to the permanent
    // allow-list.
    if (head.candidateIds) {
        const all = state.players.flatMap((p) => p.battlefield);
        const found = all.filter((c) => head.candidateIds!.includes(c.id));
        // A non-empty `candidateIds` naming zero found instances is always a
        // bug — either an untagged zone (this fallback assumes battlefield)
        // or a stale id — never a legitimate empty choice (that shape is a
        // pending choice with `candidateIds: undefined` or `[]`, both handled
        // above). Silence here is exactly what let issue #2689 fixup 2's two
        // bugs (missing library intersection, missing graveyard branch) hide
        // behind a generic downstream "Select at least 1 card" / "Card is not
        // an eligible choice" instead of naming the real cause.
        if (found.length === 0 && head.candidateIds.length > 0) {
            throw new Error(
                `listCandidates: choice kind="${head.kind}" choiceId="${head.choiceId}" ` +
                    `has ${head.candidateIds.length} candidateIds but zone="${head.zone ?? "(none)"}" ` +
                    `resolved 0 of them against any battlefield — likely an untagged zone ` +
                    `(add a listCandidates branch for it) rather than a real empty choice.`
            );
        }
        return found;
    }
    return [];
}

/** The latent worth of an instance from its registry id (ADR 0018) — the SAME
 *  primitive `buildBotView` projects onto choice candidates, so the harness
 *  orders choices exactly as live play does. */
function instanceValue(inst: CardInstanceState): number {
    const id = (inst.card as { id?: string } | undefined)?.id;
    return id ? cardValueById(id) : 0;
}

/** The registry card-definition id of an instance (`""` when unknown). */
function cardDefId(inst: CardInstanceState): string {
    return (inst.card as { id?: string } | undefined)?.id ?? "";
}

/** CR 305.1 — a land carries "Land" among its types. */
function instanceIsLand(inst: CardInstanceState): boolean {
    return inst.types.includes("Land");
}

/** The chooser's mana picture for a `discard-hand` choice (issue #242). Built
 *  from the fat self-play state so the harness orders discards EXACTLY as live
 *  play does (`buildBotView` builds the same shape from the wire projection). */
function manaSituationFor(state: GameState, playerId: string): ManaSituation {
    const player = getPlayer(state, playerId);
    const colors = new Set<string>();
    for (const perm of player.battlefield) {
        if (!instanceIsLand(perm)) continue;
        const def = tryGetDefinition(cardDefId(perm));
        if (!def) continue;
        for (const c of getCardColorIdentity(def)) colors.add(c);
    }
    return {
        landsInPlay: player.battlefield.filter(instanceIsLand).length,
        landsInHand: player.hand.filter(instanceIsLand).length,
        producibleColors: [...colors] as ManaSituation["producibleColors"],
    };
}

/** Resolve the head pending choice with the production default policy, applied
 *  through the engine-side resolvers. Mutates `state`. Returns false if the
 *  choice can't be driven headless (caller aborts the game). */
function resolvePending(state: GameState): boolean {
    const head = state.pendingChoices?.[0];
    if (!head) return false;

    if (head.kind === "may-pay") {
        // v1: accept a costless "may", decline a costed one (see file header).
        const accept = !head.cost;
        applyMayPaySubmit(state, { playerId: head.playerId, accept });
        return true;
    }

    if (head.kind === "name-card") {
        // CR 202.3 — name a card. Headless default: name the chooser's own top
        // library card so a self-targeted Petra Sphinx digs it into hand; falls
        // back to any registered card name. Routed through the dedicated
        // resolver (the submission is a name string, not instance ids).
        const chooser = state.players.find((p) => p.id === head.playerId);
        const topId = chooser?.library[0]?.id;
        const topDef = topId
            ? tryGetDefinition(
                  (chooser!.library[0].card as { id?: string }).id ?? ""
              )
            : undefined;
        const cardName = topDef?.name ?? "Plains";
        applyNameCardSubmit(state, { playerId: head.playerId, cardName });
        return true;
    }

    const min = getPendingChoiceMin(head.count);
    const max = getPendingChoiceMax(head.count);
    const candidates = listCandidates(state, head).map((c) => {
        const def = tryGetDefinition(cardDefId(c));
        return {
            id: c.id,
            value: instanceValue(c),
            // issue #242 — mana fields the discard heuristic ranks on. Cheap to
            // populate for every kind; only `discard-hand` reads them.
            isLand: instanceIsLand(c),
            manaValue: manaValue(def?.manaCost),
            colors: getColorsFromCost(def?.manaCost),
        };
    });

    let ids: string[];
    if (head.kind === "mulligan-bottom") {
        // Bottom the `min` lowest-value cards (keep the best) — the live bottom
        // heuristic also sheds worst-first.
        ids = [...candidates]
            .sort((a, b) => a.value - b.value)
            .slice(0, min)
            .map((c) => c.id);
    } else if (
        head.kind === "choose-damage-target" &&
        candidates.length === 0
    ) {
        // Players aren't zone cards: ping the first legal player (minimal).
        const pid = head.candidatePlayerIds?.[0];
        ids = pid ? [pid] : [];
    } else if (head.kind === "choose-player") {
        // Trigger-time "up to one target player" (CR 115.1a, Endurance) —
        // minimal-legal default (ADR 0016): decline (min is 0).
        ids = [];
    } else if (head.kind === "option-pick" || head.kind === "trigger-mode") {
        // CR 614.12 — body-on-entry options aren't zone cards. Minimal-legal
        // default (ADR 0016): pick the first author-listed option. CR 603.3c
        // (issue #2461) — a modal trigger's announced mode is the same shape,
        // and `options` already holds only the CHOOSABLE modes, so the first is
        // always a legal announcement.
        const optId = head.options?.[0]?.id;
        ids = optId ? [optId] : [];
    } else if (head.kind === "trigger-order") {
        // CR 603.3b (ADR 0058) — order the bot's simultaneous-trigger slice. The
        // candidates aren't zone cards; collection order (`candidateIds`) is a
        // legal canonical permutation, and self-ordering is immaterial (ADR 0058).
        ids = head.candidateIds ?? [];
    } else {
        const owed: OwedChoice = {
            kind: head.kind,
            min,
            max,
            candidates,
            // issue #242 — the discard heuristic needs the chooser's mana picture.
            manaSituation:
                head.kind === "discard-hand"
                    ? manaSituationFor(state, head.playerId)
                    : undefined,
            // ADR 0100 D3 (#2389) — the as-enters leg, so the self-play driver
            // answers a CR 614.1a optional discard cost exactly as the live
            // Brain does rather than always declining it.
            asEntersKind: head.asEntersKind,
        };
        ids = chooseResolution(owed);
    }

    applyPendingChoiceSubmit(state, {
        playerId: head.playerId,
        stackItemId: head.stackItemId,
        step: head.step,
        choiceId: head.choiceId,
        cardInstanceIds: ids,
    });
    return true;
}

/** Play one full game to completion. Seats play in `state.players` order;
 *  `seatA` is the perspective for `marginA`. `seed` makes the whole game
 *  reproducible (search determinization + tie-breaks). */
export function runHeadlessGame(
    state: GameState,
    seatA: SeatConfig,
    seatB: SeatConfig,
    seed: number,
    searchFn: SearchFn = search
): GameResult {
    const rng = makeRng(seed);
    const nextSeed = () => Math.floor(rng() * 0x7fffffff);
    const budgetFor = (pid: string): SearchBudget =>
        pid === seatA.id ? seatA.budget : seatB.budget;

    let plies = 0;
    let reason: GameEndReason = "max-plies";
    // issue #2284 — set alongside every guard reason so a headless stall names
    // the Expected Input kind that was not handled.
    let unhandledExpectedInput: ExpectedInputKind | undefined;

    while (plies < MAX_PLIES) {
        if (state.gameOver) {
            reason = state.gameOver.reason;
            break;
        }

        const pid = decidingPlayer(state);
        if (pid) {
            // A search-decided node. Guard the rollout the same way
            // `resolvePending` guards resolution nodes (ADR 0016): a crash inside
            // ISMCTS (e.g. a buggy card resolution during a rollout) ends ONLY
            // this game with `search-error` and never propagates, so a single
            // crashing card can't wipe an N-game match's measurement.
            let move;
            try {
                move = searchFn(state, pid, budgetFor(pid), nextSeed());
            } catch {
                reason = "search-error";
                break;
            }
            if (move) {
                // Mulligan keep/mull is a NO-OP in `applyMoveInSearch` (the
                // search resolves it only at its own root, never mid-rollout);
                // drive it through the real mulligan engine, as the live
                // `declareMulligan` mutation does.
                if (move.kind === "mulligan") {
                    recordDeclaration(state, pid, move.decision);
                } else {
                    applyMoveInSearch(state, pid, move);
                }
            } else {
                // No ranked move (forced window): take the first legal, else stall.
                const legal = enumerateMoves(state, pid);
                if (legal.length === 0) {
                    reason = "stall";
                    unhandledExpectedInput = computeExpectedInput(state)?.kind;
                    break;
                }
                applyMoveInSearch(state, pid, legal[0]);
            }
        } else if ((state.pendingChoices?.length ?? 0) > 0) {
            // A resolution node — production default policy.
            try {
                if (!resolvePending(state)) {
                    reason = "resolution-error";
                    unhandledExpectedInput = computeExpectedInput(state)?.kind;
                    break;
                }
            } catch {
                reason = "resolution-error";
                unhandledExpectedInput = computeExpectedInput(state)?.kind;
                break;
            }
        } else {
            // Not game over, nobody owes a decision, no pending choice: the engine
            // failed to settle to a stable point (mid-cast target / engine bug).
            // Name the window nobody drove (issue #2284) — "stall" alone told
            // you a game died, never WHICH Expected Input had no handler.
            reason = "stall";
            unhandledExpectedInput = computeExpectedInput(state)?.kind;
            break;
        }
        plies++;
    }

    const over = state.gameOver;
    // CR 104.4a — a drawn game has neither winner nor loser (empty strings on
    // `gameOver`); normalize those to null so the result reads as no-winner.
    return {
        winnerId: over?.winnerId ? over.winnerId : null,
        loserId: over?.loserId ? over.loserId : null,
        reason,
        turns: state.turn,
        plies,
        marginA: materialMargin(state, seatA.id),
        unhandledExpectedInput,
    };
}
