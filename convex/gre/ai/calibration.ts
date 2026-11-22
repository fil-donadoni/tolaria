// The calibration search (issue #10451): the same fixed search on the same
// fixed small board, timed. What a machine makes of it compares devices,
// browser engines and moments, whatever board the game itself has reached.
//
// The field's own readings all move with the board. On four production boards
// one machine took 0.9 to 3.1 ms per rollout probe (issue #10134), so a slow
// consult on a large board says "this board is that costly" and "the machine
// was busy" in the same number. This reading holds the board still.
//
// THE BOARD READS NO CATALOGUE CARD. The Brain Worker holds only the
// definitions of its game's Manifest (`src/lib/ai/brain-residency.ts`), and a
// measurement must not install a shard. So the board is tokens — a token's
// definition is decoded from its own id (`tokenDefinitionId`) — and the
// opaque placeholders a hidden zone is searched with (`PLACEHOLDER_CARD_ID`,
// never cast): one 2/2 and one 1/1 flier a side, the Bot at its
// declare-attackers step, reached through the engine's own turn structure.
// Four root declarations; a rollout that plays combat and the opponent's turn
// through the real engine, so the reading covers what a search does: clone,
// enumerate, apply, state-based actions, evaluate.
//
// A READING IS A NUMBER OF IDENTICAL UNITS. One unit builds the board and
// searches it for one iteration, root pick and trace included: the same work
// every time, on every device. A reading runs units until its time budget is
// spent and reports the mean time per unit beside how many it completed, so a
// fast machine and a slow one measure the same thing over a different number
// of samples — never a different workload. The clock is read around whole
// units, board included: nothing a reading does is outside it.
//
// THE WAIT IT CAN IMPOSE. A consult posted behind a reading in the Worker
// waits for it. A reading stops at the first unit that ends past the budget,
// so it lasts at most the budget plus one unit of the device's own. One unit
// is the floor: a device takes that long whatever the budget says. The
// measured figures are in `docs/research/calibration-reading.md`.
//
// Not a decision: nothing here is played, and no game state is read.

import type { TokenSpec } from "../../cards/types";
import { PLACEHOLDER_CARD_ID } from "../constants";
import { advancePhase } from "../phases";
import { searchWithTrace } from "../search";
import {
    createTokenPermanents,
    type CardInstanceState,
    type GameState,
    type PlayerState,
} from "../state";

/** The seat the calibration search decides for, and its opponent. */
export const CALIBRATION_BOT = "calibration-bot";
const CALIBRATION_OPPONENT = "calibration-opponent";

/** The search's seed. Fixed forever: a different seed is a different search. */
export const CALIBRATION_SEED = 0xca11b;

/** Iterations of one unit's search. One: the smallest unit there is, so the
 *  floor on a reading's length (one unit) is as low as it can be. */
export const CALIBRATION_UNIT_ITERATIONS = 1;

/** A reading's time budget: it starts no unit once this much has passed. */
export const CALIBRATION_BUDGET_MS = 25;

/** The most units one reading runs, however fast the machine. */
export const CALIBRATION_MAX_UNITS = 16;

// Named for what they are, so their definition ids can never be a real
// token's: a game that makes its own 2/2 green Bear gets its own definition.
const BEAR: TokenSpec = {
    name: "Calibration Bear",
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    colors: ["G"],
};

const SPIRIT: TokenSpec = {
    name: "Calibration Spirit",
    types: ["Creature"],
    subtypes: ["Spirit"],
    power: 1,
    toughness: 1,
    colors: ["W"],
    staticAbilities: ["flying"],
};

const HAND_SIZE = 3;
const LIBRARY_SIZE = 30;

function hiddenCard(
    playerId: string,
    index: number,
    zone: "library" | "hand"
): CardInstanceState {
    return {
        id: `calibration:${zone}:${playerId}:${index}`,
        card: { id: PLACEHOLDER_CARD_ID },
        controllerId: playerId,
        ownerId: playerId,
        zone,
        types: [],
        subtypes: [],
        staticAbilities: [],
        isTapped: false,
    };
}

function seat(id: string): PlayerState {
    return {
        id,
        name: id,
        bgColor: "#000000",
        life: 20,
        hand: Array.from({ length: HAND_SIZE }, (_, i) =>
            hiddenCard(id, i, "hand")
        ),
        library: Array.from({ length: LIBRARY_SIZE }, (_, i) =>
            hiddenCard(id, i, "library")
        ),
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    };
}

/** The calibration board: built fresh on every call, the same every time. */
export function calibrationState(): GameState {
    const state: GameState = {
        players: [seat(CALIBRATION_BOT), seat(CALIBRATION_OPPONENT)],
        stack: [],
        turn: 6,
        activePlayerId: CALIBRATION_BOT,
        priorityPlayerId: CALIBRATION_BOT,
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: CALIBRATION_SEED,
        rngCounter: 0,
    };
    const tokens = [BEAR, SPIRIT];
    state.players.forEach((player) => {
        tokens.forEach((token) => {
            createTokenPermanents(state, token, player.id, 1, undefined, {
                placement: true,
            });
        });
        player.battlefield.forEach((permanent) => {
            permanent.isSummoningSick = false;
        });
    });
    // To the declare-attackers step through the engine's own turn structure,
    // so the combat state is the one a real game holds there.
    for (
        let step = 0;
        step < 4 && state.phase !== "DECLARE_ATTACKERS";
        step++
    ) {
        advancePhase(state);
    }
    return state;
}

/** One calibration reading. */
export type CalibrationReading = {
    /** Mean wall-clock milliseconds per unit: one iteration's search with the
     *  board built before it and the root read after it. */
    msPerIteration: number;
    /** Units completed: the samples behind the mean. A reading of one or two
     *  ran mostly cold code. */
    iterations: number;
};

/** The search every unit runs. */
const UNIT_BUDGET = {
    iterations: CALIBRATION_UNIT_ITERATIONS,
    // The settle rule must not end it early: every unit is the same work.
    minIterations: CALIBRATION_UNIT_ITERATIONS,
};

/** Run one calibration reading: units of identical work until the budget is
 *  spent, timed as a whole. `null` when it measured nothing (a unit that did
 *  not search, or a clock that did not advance). Never throws: a calibration
 *  that fails is no reading. `now` is the clock, injectable for a
 *  deterministic test; it is read once to start and once after each unit. */
export function runCalibration(
    now: () => number = () => performance.now()
): CalibrationReading | null {
    try {
        const start = now();
        let units = 0;
        let elapsed = 0;
        while (units < CALIBRATION_MAX_UNITS) {
            const { trace } = searchWithTrace(
                calibrationState(),
                CALIBRATION_BOT,
                UNIT_BUDGET,
                CALIBRATION_SEED
            );
            if (trace?.iterationsCompleted !== CALIBRATION_UNIT_ITERATIONS) {
                return null;
            }
            units += 1;
            elapsed = now() - start;
            if (elapsed >= CALIBRATION_BUDGET_MS) break;
        }
        const iterations = units * CALIBRATION_UNIT_ITERATIONS;
        const msPerIteration = elapsed / iterations;
        if (!Number.isFinite(msPerIteration) || msPerIteration <= 0) {
            return null;
        }
        return { msPerIteration, iterations };
    } catch {
        return null;
    }
}
