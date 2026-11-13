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
// `"MULLIGAN"`. After bottoming completes, `finalizeMulligan` opens the
// opening-hand action window (CR 103.6, still in `"MULLIGAN"`): the starting
// player, then each other player in turn order, may put opening-hand cards
// that allow it onto the battlefield. Once the window closes, `startFirstTurn`
// clears the mulligan field, sets phase back to `"UNTAP"`, and calls
// advancePhase to land at UPKEEP of turn 1 — the same pipeline a freshly
// initialized game used before mulligan was implemented.

import { tryGetDefinition } from "../cards";
import {
    type CardInstanceState,
    type GameState,
    type MulliganState,
    type PendingChoice,
    type PlayerState,
    moveCard,
    processPendingActionTriggers,
    putHandCardOntoBattlefield,
} from "./state";
import { advancePhase, drainAutoPasses } from "./phases";
import { seededShuffle } from "./rng";
import type { Phase } from "./types";

/** The stackless sentinel an opening-hand action choice carries in
 *  `stackItemId` (CR 103.6) — there is no stack object behind it. */
export const OPENING_HAND_STACK_ITEM_ID = "opening-hand";

/** Prefix of the `choiceId` of the follow-up pick a begun card asks for
 *  (`OpeningHandBegin.exileFromHand`), which shares the
 *  `opening-hand-action` kind with the action pick itself. */
const OPENING_HAND_EXILE_CHOICE_PREFIX = "opening-hand-exile-";

/** Whether `head` is the exile-from-hand follow-up pick (CR 103.6a). */
export function isOpeningHandExileChoice(head: PendingChoice): boolean {
    return head.choiceId.startsWith(OPENING_HAND_EXILE_CHOICE_PREFIX);
}

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

/** The mulligan process is complete (CR 103.5): open the opening-hand action
 *  window (CR 103.6), which starts the first turn itself once every player
 *  has acted. */
export function finalizeMulligan(state: GameState): void {
    const m = state.mulligan;
    if (!m) throw new Error("Mulligan state missing");
    m.openingHand = { actorPosition: -1, queued: [] };
    advanceOpeningHandWindow(state);
}

/** CR 103.6 — the opening-hand cards `player` may take an action with: those
 *  that let them begin the game on the battlefield (CR 103.6a) and those they
 *  may reveal (CR 103.6b), the latter only once each. */
export function openingHandActionCards(
    state: GameState,
    player: PlayerState
): CardInstanceState[] {
    const revealed = state.mulligan?.openingHand?.revealed ?? [];
    return player.hand.filter((card) => {
        const id = (card.card as { id?: string }).id;
        if (id === undefined) return false;
        const definition = tryGetDefinition(id);
        const action = definition?.openingHandAction;
        if (action === "reveal") return !revealed.includes(card.id);
        // CR 103.6a — "and you're not the starting player": the starting
        // player is the first turn's active player.
        if (
            definition?.openingHandBegin?.notStartingPlayer &&
            player.id === state.activePlayerId
        )
            return false;
        return action === "begin-on-battlefield";
    });
}

/** CR 103.6b — reveal `card` from `player`'s opening hand: every player sees
 *  it until the first turn begins, and the delayed triggered ability the card
 *  describes is created (CR 603.7a) to trigger at the beginning of that
 *  player's first upkeep — their own, which for a player not on the play is
 *  turn 2's. `next-upkeep` + `targetPlayerId` is exactly that: it fires at the
 *  first upkeep of that player reached after scheduling, once. */
function revealOpeningHandCard(
    state: GameState,
    playerId: string,
    card: CardInstanceState
): void {
    const window = state.mulligan?.openingHand;
    const definition = tryGetDefinition((card.card as { id: string }).id);
    const reveal = definition?.openingHandReveal;
    if (!window || !reveal) return;
    window.revealed = [...(window.revealed ?? []), card.id];
    card.knownTo = state.players.map((p) => p.id);
    state.nextDelayedSeq = (state.nextDelayedSeq ?? 0) + 1;
    state.delayedTriggers = [
        ...(state.delayedTriggers ?? []),
        {
            id: `delayed-${state.nextDelayedSeq}`,
            sourceCardId: definition.id,
            sourceInstanceId: card.id,
            triggerId: "opening-hand-reveal",
            controller: playerId,
            timing: "next-upkeep",
            targetPlayerId: playerId,
            payload: {},
            effects: reveal.effects,
            oracleText: reveal.oracleText,
        },
    ];
}

/** The player `turnOrderPosition` seats after the starting player — the
 *  active player of the first turn (CR 103.1), who need not be `players[0]`
 *  (a later Game of a Match starts with the chosen player on the play). */
function playerInTurnOrder(
    state: GameState,
    turnOrderPosition: number
): PlayerState {
    const start = state.players.findIndex((p) => p.id === state.activePlayerId);
    const n = state.players.length;
    return state.players[(Math.max(start, 0) + turnOrderPosition) % n];
}

/** CR 103.6 — hand the window to the next player in turn order from the
 *  starting player who has an opening-hand action to take, raising their
 *  `opening-hand-action` choice. A player with none is skipped without a
 *  prompt. When nobody is left, the first turn begins. */
function advanceOpeningHandWindow(state: GameState): void {
    const window = state.mulligan?.openingHand;
    if (!window) throw new Error("Opening-hand window is not open");
    for (
        let position = window.actorPosition + 1;
        position < state.players.length;
        position++
    ) {
        const player = playerInTurnOrder(state, position);
        const eligible = openingHandActionCards(state, player);
        if (eligible.length === 0) continue;
        window.actorPosition = position;
        const choice: PendingChoice = {
            stackItemId: OPENING_HAND_STACK_ITEM_ID,
            step: 0,
            choiceId: `opening-hand-${player.id}`,
            playerId: player.id,
            kind: "opening-hand-action",
            zone: "hand",
            candidateIds: eligible.map((c) => c.id),
            count: { min: 0, max: eligible.length },
            prompt: "Choose cards from your opening hand to begin the game with on the battlefield or to reveal",
            // CR 103.6 — the eligible cards sit in a hidden zone (CR 400.2):
            // the opponent sees the pause, never the cards it is about.
            privateToChooser: true,
        };
        state.pendingChoices = [...(state.pendingChoices ?? []), choice];
        state.priorityPlayerId = player.id;
        return;
    }
    startFirstTurn(state);
}

/** Apply the front `opening-hand-action` PendingChoice (CR 103.6a): the chosen
 *  cards are put onto the battlefield one at a time, in the order picked
 *  ("in any order", CR 103.6). Putting is not casting nor playing, so it goes
 *  through the shared non-cast entry path — entry replacements and ETB
 *  triggers apply; the triggers wait in `pendingEvents` until a player first
 *  receives priority, in the first turn's upkeep. `selectedIds` has already
 *  passed the zone-pick check (in hand, in `candidateIds`, within count). */
export function applyOpeningHandChoice(
    state: GameState,
    selectedIds: string[]
): void {
    const choices = state.pendingChoices;
    const choice = choices?.[0];
    if (!choice || choice.kind !== "opening-hand-action") {
        throw new Error("No opening-hand action choice to apply");
    }
    const window = state.mulligan?.openingHand;
    if (!window) throw new Error("Opening-hand window is not open");
    choices!.shift();
    state.pendingChoices = choices!.length > 0 ? choices : undefined;
    // CR 103.6b — a reveal needs nothing further, so it is taken at once;
    // the rest enter the battlefield one at a time (CR 103.6a).
    const actor = playerInTurnOrder(state, window.actorPosition);
    window.queued = [];
    for (const id of selectedIds) {
        const card = actor.hand.find((c) => c.id === id);
        if (!card) continue;
        const action = tryGetDefinition(
            (card.card as { id: string }).id
        )?.openingHandAction;
        if (action === "reveal") revealOpeningHandCard(state, actor.id, card);
        else window.queued.push(id);
    }
    resumeOpeningHandWindow(state);
}

/** Carry the window on after the actor's pick, or after an as-enters choice
 *  one of the picked cards parked on (CR 614.12a — `finalizeAsEnters` calls
 *  here). Once the window has closed and the first turn begun, the active
 *  player holds priority, as after the mulligan bottom pick.
 *
 *  CR 117.5 — abilities that triggered on a pre-game entry wait until a player
 *  would first receive priority, in the first turn's upkeep, so they are
 *  flushed here. They are placed as their own batch, above any "at the
 *  beginning of your upkeep" triggers `advancePhase` already stacked, rather
 *  than ordered together with those in one CR 603.3b batch. */
export function resumeOpeningHandWindow(state: GameState): void {
    continueOpeningHandWindow(state);
    if (!state.mulligan) processPendingActionTriggers(state);
    if ((state.pendingChoices?.length ?? 0) === 0) {
        state.priorityPlayerId = state.activePlayerId;
        state.passCount = 0;
        drainAutoPasses(state);
    }
}

/** Put the actor's queued cards onto the battlefield until the queue empties
 *  or an entry parks on an as-enters choice; then hand the window on. */
function continueOpeningHandWindow(state: GameState): void {
    const window = state.mulligan?.openingHand;
    if (!window) throw new Error("Opening-hand window is not open");
    const actor = playerInTurnOrder(state, window.actorPosition);
    while ((state.pendingChoices?.length ?? 0) === 0) {
        const next = window.queued.shift();
        if (next === undefined) {
            advanceOpeningHandWindow(state);
            return;
        }
        const rider = tryGetDefinition(
            (actor.hand.find((c) => c.id === next)?.card as { id?: string })
                ?.id ?? ""
        )?.openingHandBegin;
        const entered = putHandCardOntoBattlefield(
            state,
            actor.id,
            next,
            rider?.counters
        );
        // CR 103.6a — "If you do, exile a card from your hand": asked only
        // once the card did begin the game on the battlefield.
        if (entered && rider?.exileFromHand && actor.hand.length > 0)
            raiseOpeningHandExileChoice(
                state,
                actor,
                next,
                rider.exileFromHand
            );
    }
    state.priorityPlayerId = state.pendingChoices![0].playerId;
}

/** CR 103.6a — park the window on the actor's exile-from-hand pick for the
 *  card that just began the game on the battlefield. Every hand card is a
 *  candidate; a hand smaller than `count` exiles all of it. Private to the
 *  chooser (CR 400.2). */
function raiseOpeningHandExileChoice(
    state: GameState,
    actor: PlayerState,
    sourceCardId: string,
    count: number
): void {
    const exactly = Math.min(count, actor.hand.length);
    state.pendingChoices = [
        ...(state.pendingChoices ?? []),
        {
            stackItemId: OPENING_HAND_STACK_ITEM_ID,
            step: 0,
            choiceId: `${OPENING_HAND_EXILE_CHOICE_PREFIX}${sourceCardId}`,
            playerId: actor.id,
            kind: "opening-hand-action",
            zone: "hand",
            candidateIds: actor.hand.map((c) => c.id),
            count: { min: exactly, max: exactly },
            prompt: "Exile a card from your hand",
            privateToChooser: true,
        },
    ];
}

/** Apply the exile-from-hand follow-up pick (CR 103.6a): the chosen cards go
 *  from the actor's hand to exile, then the window carries on. */
export function applyOpeningHandExile(
    state: GameState,
    selectedIds: string[]
): void {
    const choices = state.pendingChoices;
    const choice = choices?.[0];
    if (!choice || !isOpeningHandExileChoice(choice)) {
        throw new Error("No opening-hand exile choice to apply");
    }
    choices!.shift();
    state.pendingChoices = choices!.length > 0 ? choices : undefined;
    const actor = state.players.find((p) => p.id === choice.playerId)!;
    for (const id of selectedIds) moveCard(actor, id, "hand", "exile");
    resumeOpeningHandWindow(state);
}

/** Clears the mulligan state and advances the engine to UPKEEP of turn 1
 *  using the existing phase pipeline (UNTAP is auto-skipped). */
export function startFirstTurn(state: GameState): void {
    // CR 103.6b — a card revealed from an opening hand "remains revealed until
    // the first turn begins".
    const revealed = state.mulligan?.openingHand?.revealed ?? [];
    for (const player of state.players) {
        for (const card of player.hand) {
            if (revealed.includes(card.id)) delete card.knownTo;
        }
    }
    state.mulligan = undefined;
    // CR 103.5 (issue #1714) — the opening hand is drawn BEFORE turn 1 begins,
    // so none of it was drawn "this turn". Every opening hand is dealt through
    // `drawCard`, which appends to the per-turn tally, and this walks to UPKEEP
    // via `advancePhase`, never `advanceTurn` (the tally's only other reset).
    // Without this clear turn 1's first real draw is stamped index 7: a
    // Leovold-style `drawIndexThisTurn >= 1` prevents it, `nthDrawThisTurn`
    // never matches. A mulligan redraw appends nothing, so the tally would
    // also still name the shuffled-away hand. Cleared before `advancePhase`,
    // so an upkeep draw counts from zero.
    for (const player of state.players) {
        player.drawnThisTurn = undefined;
        player.lastDrawnCardId = undefined;
        // CR 103.6a — a card that began the game on the battlefield entered
        // BEFORE turn 1, so it did not enter "this turn" and was no
        // qualifying action of it (Arboria's tally). The entry stamped both against
        // the turn number the game already reads; this walk never reaches the
        // turn boundary that would roll them over.
        player.qualifyingActionThisTurn = undefined;
        for (const card of player.battlefield) {
            card.enteredOnTurn = undefined;
            // CR 302.6 — the starting player has controlled it continuously
            // since before their most recent turn (turn 1) began. Any other
            // player's stays sick until their own first untap step clears it.
            if (player.id === state.activePlayerId) {
                card.isSummoningSick = undefined;
            }
        }
    }
    state.phase = "UNTAP" as Phase;
    advancePhase(state);
}
