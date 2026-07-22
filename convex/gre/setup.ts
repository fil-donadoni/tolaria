// Pure game-setup: build the initial `GameState` from two deck inputs (CR 103).
//
// Extracted from the `createGame` / `createSoloGame` Convex mutations so the SAME
// initialization (library build, shuffle, opening-hand draw, mulligan entry) is
// shared by the authoritative server path AND the headless self-play harness
// (`src/lib/ai/selfplay`). The mutations own persistence + the `games` row; this
// module owns nothing but the pure state assembly, seeded by an explicit `seed`
// so a game is fully reproducible from it.

import {
    type GameState,
    type PlayerState,
    allocInstanceId,
    drawCard,
} from "./state";
import { seededShuffle } from "./rng";
import { makeMulliganState } from "./mulligan";
import type { Phase } from "./types";
import { getDefinition } from "../cards";

/** Number of cards in the opening hand (CR 103.4). */
export const STARTING_HAND_SIZE = 7;

/** Starting life total for a two-player game (CR 103.1). */
export const STARTING_LIFE = 20;

export type DeckInput = {
    id: string;
    name: string;
    format: string;
    cards: { cardId: string; cardName: string }[];
};

export type PlayerInput = {
    id: string;
    name: string;
    bgColor: string;
    deck: DeckInput;
};

/** Build a player's starting state: every deck card as a library instance, life
 *  20, empty zones (CR 103.1). Instance ids are allocated from the shared
 *  `counter` so both players' ids are globally unique within the game. */
export function buildPlayerState(
    player: PlayerInput,
    counter: { nextInstanceId?: number }
): PlayerState {
    const instances = player.deck.cards.map((deckCard) => {
        const def = getDefinition(deckCard.cardId);
        return {
            id: allocInstanceId(counter),
            card: { id: def.id },
            types: def.types,
            subtypes: def.subtypes ?? [],
            power: def.power,
            toughness: def.toughness,
            staticAbilities: def.staticAbilities ?? [],
            controllerId: player.id,
            ownerId: player.id,
            zone: "library" as const,
            isTapped: false,
        };
    });

    return {
        id: player.id,
        name: player.name,
        bgColor: player.bgColor,
        life: STARTING_LIFE,
        hand: [],
        library: instances,
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

/** Assemble the full initial `GameState` for `players` (turn order = array
 *  order), seeded by `seed` for reproducibility. Shuffles each library, draws
 *  opening hands (CR 103.4), and enters the mulligan phase with declarations
 *  starting from the active player (CR 103.5); `advancePhase` is deferred to
 *  `finalizeMulligan`. Pure — no persistence, no `games` row. */
export function createInitialGameState(
    players: PlayerInput[],
    seed: number
): GameState {
    const counter: { nextInstanceId?: number } = {};
    const playersState = players.map((p) => buildPlayerState(p, counter));
    // CR 500.1: the starting player begins their first turn at game start.
    playersState[0].turnsTaken = 1;

    const state: GameState = {
        players: playersState,
        stack: [],
        turn: 1,
        activePlayerId: playersState[0].id,
        priorityPlayerId: playersState[0].id,
        passCount: 0,
        phase: "UNTAP" as Phase,
        rngSeed: seed,
        rngCounter: 0,
        nextInstanceId: counter.nextInstanceId,
    };

    for (const player of state.players) {
        seededShuffle(state, player.library);
        for (let i = 0; i < STARTING_HAND_SIZE; i++) drawCard(player);
    }

    // CR 103.5: enter the mulligan phase — declarations begin with the starting
    // player. advancePhase is deferred to finalizeMulligan.
    state.phase = "MULLIGAN" as Phase;
    state.mulligan = makeMulliganState(state);
    state.priorityPlayerId = state.mulligan.declaringPlayerId;

    return state;
}
