// The generated-vector cost bench payload (issue #10862): `entry.mjs`'s
// `__brainBench`, plus `__brainBench.generated` — a board searched under the
// base Evaluation or under a named search variant (`generated-vector`: the
// generated vector read at every evaluation, priced by the committed table).
//
// A board is a field fixture (`field-position.mjs`) or a LATE-GAME BOARD OF A
// SELF-PLAYED GAME: two Preset Decks played headless by the search itself,
// the position captured at a precombat main phase once the game is late, the
// board wide and the mover has a real choice. Field fixtures hold real games
// and stay out of the repository; a self-played board is rebuilt from a seed
// on any machine, and is kept here AS a fixture — the engine's own compacted
// row — so both kinds are searched by the one `runField` of `entry.mjs`.
//
// Two readings per board: a whole search (`runBoard`), and the Evaluation
// alone (`evaluationCost`), which no rollout's dice and no other session's
// load can blur.

import "./entry.mjs";
import { createInitialGameState } from "../../../../convex/gre";
import { cloneGameState } from "../../../../convex/gre/clone";
import { evaluateWithMargin } from "../../../../convex/gre/evaluate";
import { enumerateMoves } from "../../../../convex/gre/moves";
import { decidingPlayer, search } from "../../../../convex/gre/search";
import { compactState, expandState } from "../../../../convex/gre/serialize";
import {
    LADDER_VARIANTS,
    resolveEvalWeights,
    setSearchVariant,
} from "../../../../convex/gre/ai/searchVariant";
import { presetToPlayerInput } from "../../../../src/lib/ai/selfplay/decks";
import { runHeadlessGame } from "../../../../src/lib/ai/selfplay/playGame";

/** The variant an arm names: none for `"base"`. */
function variantOf(arm) {
    if (arm === "base") return null;
    const variant = LADDER_VARIANTS[arm];
    if (!variant) throw new Error(`no search variant named "${arm}"`);
    return variant;
}

/** `run` under the base search (`"base"`) or the named variant. */
function underArm(arm, run) {
    const variant = variantOf(arm);
    if (!variant) return run();
    setSearchVariant(variant);
    try {
        return run();
    } finally {
        setSearchVariant(null);
    }
}

function permanentsOf(state) {
    return state.players.reduce((n, p) => n + p.battlefield.length, 0);
}

/** The fixtures kept so far, by label. */
const fixtures = new Map();

/** Keep `fixture` and say what it holds. */
function keep(fixture) {
    fixtures.set(fixture.label, fixture);
    const state = positionOf(fixture);
    return {
        label: fixture.label,
        turn: state?.turn ?? null,
        permanents: state ? permanentsOf(state) : null,
    };
}

function fixtureOf(label) {
    const fixture = fixtures.get(label);
    if (!fixture) throw new Error(`no board "${label}"`);
    return fixture;
}

/** A fixture's position as the search is handed it, or `null` for a fixture
 *  that holds no stored row. The stored row expanded, and a finished game made
 *  playable again the way `entry.mjs`'s `fieldState` does (it is not
 *  exported): no outcome, the loser back at 10 life. */
function positionOf(fixture) {
    if (!fixture.state) return null;
    const state = expandState(
        structuredClone(fixture.state),
        fixture.libraries ?? undefined
    );
    if (state.gameOver) {
        delete state.gameOver;
        for (const player of state.players) {
            if (player.life <= 0) player.life = 10;
        }
    }
    state.priorityPlayerId = state.activePlayerId;
    state.passCount = 0;
    return state;
}

/**
 * Play `deckA` against `deckB` headless from `seed`, every decision searched
 * at `playIterations`, and keep the WIDEST board the game reaches at the
 * start of a precombat main phase from turn `minTurn` on: the active player
 * to decide, nothing on the stack, at least `MIN_MOVES` legal moves (a
 * position with one move is not searched). Returns what was kept, or `null`
 * when the game reached no such position.
 */
const MIN_MOVES = 3;

function selfPlayBoard({ deckA, deckB, seed, playIterations, minTurn }) {
    const state = createInitialGameState(
        [
            presetToPlayerInput(deckA, 0, "S0"),
            presetToPlayerInput(deckB, 1, "S1"),
        ],
        seed
    );
    let best = null;
    const capturing = (st, pid, ...rest) => {
        if (
            st.turn >= minTurn &&
            st.phase === "PRECOMBAT_MAIN" &&
            st.stack.length === 0 &&
            pid === st.activePlayerId &&
            (best === null || permanentsOf(st) > permanentsOf(best)) &&
            enumerateMoves(st, pid).length >= MIN_MOVES
        ) {
            best = cloneGameState(st);
        }
        return search(st, pid, ...rest);
    };
    const budget = { iterations: playIterations };
    const result = runHeadlessGame(
        state,
        { id: "S0", budget },
        { id: "S1", budget },
        seed,
        capturing
    );
    if (!best) return null;
    return {
        ...keep({
            label: `self-play ${deckA} v ${deckB} seed ${seed} turn ${best.turn}`,
            state: compactState(best),
            libraries: null,
        }),
        gameTurns: result.turns,
        gameEnd: result.reason,
    };
}

/** Search a kept board under `arm`, through `entry.mjs`'s `runField`. */
function runBoard(label, options, arm) {
    const fixture = fixtureOf(label);
    return underArm(arm, () =>
        globalThis.__brainBench.runField(fixture, options)
    );
}

/** The CPU milliseconds `calls` evaluations of a kept board take under
 *  `arm`'s weights, for the seat that owes the decision: the leaf the search
 *  scores, with nothing of the search around it. `null` for a fixture that
 *  holds no stored row. */
function evaluationCost(label, calls, arm) {
    const state = positionOf(fixtureOf(label));
    if (!state) return null;
    const weights = resolveEvalWeights(variantOf(arm));
    const seat = decidingPlayer(state);
    let sum = 0;
    const t0 = process.cpuUsage();
    for (let i = 0; i < calls; i++) {
        sum += evaluateWithMargin(state, seat, weights).value;
    }
    const t = process.cpuUsage(t0);
    return { cpuMs: (t.user + t.system) / 1000, sum };
}

globalThis.__brainBench.generated = {
    selfPlayBoard,
    fieldBoard: keep,
    runBoard,
    evaluationCost,
};
