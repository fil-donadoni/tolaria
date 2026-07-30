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
//   * mid-cast target re-selection (`pendingTarget` from copy effects, Fork) is
//     not driven — such a game aborts with reason `"resolution-error"`.

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
import { manaValue } from "@convex/gre/constants";
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
 *  validates against, so the picked ids are always legal. */
function listCandidates(
    state: GameState,
    head: PendingChoice
): CardInstanceState[] {
    const zoneOwner = getPlayer(state, head.zoneOwnerId ?? head.playerId);

    if (head.zone === "hand") {
        const pool = zoneOwner.hand;
        return head.candidateIds
            ? pool.filter((c) => head.candidateIds!.includes(c.id))
            : pool;
    }
    if (head.zone === "library") {
        return zoneOwner.library;
    }
    if (head.zone === "battlefield") {
        const pool = head.allControllers
            ? state.players.flatMap((p) => p.battlefield)
            : zoneOwner.battlefield;
        const filtered = head.filter
            ? pool.filter((c) =>
                  matchesPermanentFilter(c, head.filter!, {
                      // CR 701.16 (issue #1938 fixup 2) — resolves
                      // `controllerRelation` ("sacrifice two Swamps YOU
                      // control") against the CHOOSER. Without this the
                      // filter fails CLOSED, the candidate pool goes empty
                      // even though `head.candidateIds` (intersected below)
                      // already lists legal picks, and the headless bot can't
                      // enumerate a move for the pick.
                      selfControllerId: head.playerId,
                  })
              )
            : pool;
        return head.candidateIds
            ? filtered.filter((c) => head.candidateIds!.includes(c.id))
            : filtered;
    }
    // No zone (e.g. choose-damage-target): fall back to the permanent allow-list.
    if (head.candidateIds) {
        const all = state.players.flatMap((p) => p.battlefield);
        return all.filter((c) => head.candidateIds!.includes(c.id));
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
    } else if (head.kind === "option-pick") {
        // CR 614.12 — body-on-entry options aren't zone cards. Minimal-legal
        // default (ADR 0016): pick the first author-listed option.
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
                    break;
                }
                applyMoveInSearch(state, pid, legal[0]);
            }
        } else if ((state.pendingChoices?.length ?? 0) > 0) {
            // A resolution node — production default policy.
            try {
                if (!resolvePending(state)) {
                    reason = "resolution-error";
                    break;
                }
            } catch {
                reason = "resolution-error";
                break;
            }
        } else {
            // Not game over, nobody owes a decision, no pending choice: the engine
            // failed to settle to a stable point (mid-cast target / engine bug).
            reason = "stall";
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
    };
}
