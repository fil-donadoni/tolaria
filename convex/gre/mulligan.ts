// London Mulligan engine (CR 103.5).
//
// Pre-game phase. After each player draws their starting hand, a sequence of
// declaration rounds proceeds in turn order from the starting player. Each
// round, every still-unlocked player declares "keep" or "mull"; once all
// have declared, all "mull" players simultaneously shuffle their hand back
// into their library and redraw a fresh hand. Players who chose "keep" lock
// in their opening hand. The process repeats until every player is locked.
// Locked players who took at least one mulligan must then put N cards from
// their final hand on the bottom of their library, where N = mulligansTaken.
//
// State lives in `GameState.mulligan` (MulliganState). The phase name is
// `"MULLIGAN"`. After bottoming completes, `finalizeMulligan` clears the
// mulligan field, sets phase back to `"UNTAP"`, and calls advancePhase to
// land at UPKEEP of turn 1 — the same pipeline a freshly initialized game
// used before mulligan was implemented.

import {
    type GameState,
    type MulliganState,
    type PendingChoice,
    type PlayerState,
    moveCard,
} from "./state";
import { advancePhase } from "./phases";
import { seededShuffle } from "./rng";
import type { Phase } from "./types";

/** Initial hand size (CR 103.5; constant for now — Vanguard / hand-modifier
 *  effects are out of scope). Mirrored from game.ts to avoid a cycle. */
const STARTING_HAND_SIZE = 7;

/** Build the initial mulligan state for a new game. The starting player
 *  declares first (CR 103.5). */
export function makeMulliganState(state: GameState): MulliganState {
    return {
        mulligansTaken: state.players.map(() => 0),
        declarations: state.players.map(() => null),
        locked: state.players.map(() => false),
        declaringPlayerId: state.players[0].id,
        bottoming: false,
    };
}

/** Returns the next unlocked player in turn order from the starting player,
 *  or null if all players are locked. Used to advance `declaringPlayerId`
 *  after a player declares within a round. */
function nextDeclaringPlayerId(state: GameState): string | null {
    const m = state.mulligan;
    if (!m) return null;
    for (let i = 0; i < state.players.length; i++) {
        const id = state.players[i].id;
        if (!m.locked[i] && m.declarations[i] === null) return id;
    }
    return null;
}

/** Records a player's declaration. If every still-unlocked player has now
 *  declared this round, executes the round (mull players reshuffle + redraw,
 *  keep players lock). Returns true when the mulligan phase has fully
 *  resolved (no further declarations OR bottoming pending). */
export function recordDeclaration(
    state: GameState,
    playerId: string,
    decision: "keep" | "mull"
): void {
    const m = state.mulligan;
    if (!m) throw new Error("Mulligan state missing");
    if (m.bottoming) {
        throw new Error("Cannot declare mulligan during bottoming");
    }
    if (m.declaringPlayerId !== playerId) {
        throw new Error(
            `Not your turn to declare: expected ${m.declaringPlayerId}`
        );
    }

    const idx = state.players.findIndex((p) => p.id === playerId);
    if (idx === -1) throw new Error(`Player not found: ${playerId}`);
    if (m.locked[idx]) throw new Error("Player already locked their hand");

    m.declarations[idx] = decision;

    const next = nextDeclaringPlayerId(state);
    if (next !== null) {
        m.declaringPlayerId = next;
        state.priorityPlayerId = next;
        return;
    }

    // All unlocked players have declared this round — execute it.
    executeMulliganRound(state);
}

/** Apply the current round's declarations: mull players reshuffle hand into
 *  library, shuffle, and redraw STARTING_HAND_SIZE; keep players lock.
 *  Resets declarations for the next round. If everyone is locked at the end,
 *  transitions to bottoming. */
export function executeMulliganRound(state: GameState): void {
    const m = state.mulligan;
    if (!m) throw new Error("Mulligan state missing");

    // Deterministic order for "simultaneous" reshuffle/redraw (CR 103.5 says
    // "at the same time" but doesn't specify RNG ordering; index order is
    // arbitrary and reproducible from the seed).
    for (let i = 0; i < state.players.length; i++) {
        if (m.locked[i]) continue;
        const player = state.players[i];
        const decision = m.declarations[i];

        if (decision === "mull") {
            shuffleHandIntoLibrary(state, player);
            for (let j = 0; j < STARTING_HAND_SIZE; j++) {
                drawTopOfLibrary(player);
            }
            m.mulligansTaken[i]++;
            // Forced-lock when the next mulligan would put zero cards in hand
            // (CR 103.5: "until their opening hand would be zero cards").
            if (m.mulligansTaken[i] >= STARTING_HAND_SIZE) {
                m.locked[i] = true;
            }
        } else if (decision === "keep") {
            m.locked[i] = true;
        } else {
            throw new Error(
                `Player ${player.id} has not declared a mulligan decision`
            );
        }

        m.declarations[i] = null;
    }

    if (m.locked.every(Boolean)) {
        enterBottomingPhase(state);
        return;
    }

    const next = nextDeclaringPlayerId(state);
    if (next === null) {
        // Should not happen (we checked locked.every), but be defensive.
        enterBottomingPhase(state);
        return;
    }
    m.declaringPlayerId = next;
    state.priorityPlayerId = next;
}

/** Move every card from a player's hand into their library and shuffle
 *  (CR 103.5). The destination position doesn't matter — the library is
 *  shuffled immediately after. */
function shuffleHandIntoLibrary(state: GameState, player: PlayerState): void {
    const handIds = player.hand.map((c) => c.id);
    for (const id of handIds) moveCard(player, id, "hand", "library");
    seededShuffle(state, player.library);
}

/** Inline equivalent of `drawCard` without the empty-library flag — during
 *  mulligan the library is always non-empty (we just put 7 cards into it). */
function drawTopOfLibrary(player: PlayerState): void {
    if (player.library.length === 0) return;
    moveCard(player, player.library[0].id, "library", "hand");
}

/** Transitions to the bottoming phase. Enqueues one `mulligan-bottom`
 *  PendingChoice per player with mulligansTaken > 0, in turn order. If no
 *  player took a mulligan, finalizes immediately. */
export function enterBottomingPhase(state: GameState): void {
    const m = state.mulligan;
    if (!m) throw new Error("Mulligan state missing");
    m.bottoming = true;
    m.declaringPlayerId = "";

    state.pendingChoices = state.pendingChoices ?? [];
    for (let i = 0; i < state.players.length; i++) {
        const n = m.mulligansTaken[i];
        if (n === 0) continue;
        const player = state.players[i];
        const count = Math.min(n, player.hand.length);
        if (count === 0) continue;
        const choice: PendingChoice = {
            stackItemId: "mulligan",
            step: 0,
            choiceId: `mulligan-bottom-${player.id}`,
            playerId: player.id,
            kind: "mulligan-bottom",
            zone: "hand",
            count,

            prompt: `Put ${count} card${count === 1 ? "" : "s"} on the bottom of your library`,
        };
        state.pendingChoices.push(choice);
    }

    if (state.pendingChoices.length === 0) {
        finalizeMulligan(state);
    } else {
        state.priorityPlayerId = state.pendingChoices[0].playerId;
    }
}

/** Apply the front `mulligan-bottom` PendingChoice and pop it from the
 *  queue. If no further bottoming choices remain, finalize the mulligan
 *  phase. `selectedIds` is the batch the chooser submitted (ADR 0007). */
export function applyMulliganBottomChoice(
    state: GameState,
    selectedIds: string[]
): void {
    const choices = state.pendingChoices;
    if (!choices || choices.length === 0) {
        throw new Error("No pending choice to apply");
    }
    const choice = choices[0];
    if (choice.kind !== "mulligan-bottom") {
        throw new Error(
            `applyMulliganBottomChoice called for kind ${choice.kind}`
        );
    }
    if (selectedIds.length !== choice.count) {
        throw new Error(
            `Mulligan bottom: expected ${choice.count} cards, got ${selectedIds.length}`
        );
    }

    const player = state.players.find((p) => p.id === choice.playerId);
    if (!player) throw new Error(`Player not found: ${choice.playerId}`);

    for (const cardId of selectedIds) {
        // moveCard appends to library (push) — that's the bottom (CR 103.5),
        // since drawCard reads from index 0.
        moveCard(player, cardId, "hand", "library");
    }

    choices.shift();
    if (choices.length === 0) {
        state.pendingChoices = undefined;
        finalizeMulligan(state);
    } else {
        state.priorityPlayerId = choices[0].playerId;
    }
}

/** Clears the mulligan state and advances the engine to UPKEEP of turn 1
 *  using the existing phase pipeline (UNTAP is auto-skipped). */
export function finalizeMulligan(state: GameState): void {
    state.mulligan = undefined;
    state.phase = "UNTAP" as Phase;
    advancePhase(state);
}
