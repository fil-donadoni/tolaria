// Aggregates a batch of headless games into a comparable report. A "match" is N
// games between two SEATS (each = a deck + a search budget). Seats are labeled
// "A" / "B" with STABLE ids, and the on-the-play seat alternates every game so
// first-player advantage is averaged out rather than baked into the win-rate.
//
// This is the measurement the AI work optimizes against: run a match before a
// change and after, and compare the reports. A change is a net improvement only
// if it moves the numbers in the right direction across enough games to clear
// the noise (see `winRateA` + `games`).

import { createInitialGameState, type SearchBudget } from "@convex/gre";
import { presetToPlayerInput } from "./decks";
import {
    runHeadlessGame,
    type GameResult,
    type GameEndReason,
    type SeatConfig,
} from "./playGame";

/** The per-game runner. Defaults to the production `runHeadlessGame`;
 *  injectable so the seat/turn accounting in `runMatch` can be unit-tested
 *  deterministically without driving a full ISMCTS game (issue #243). */
export type GameRunner = (
    state: ReturnType<typeof createInitialGameState>,
    seatA: SeatConfig,
    seatB: SeatConfig,
    seed: number
) => GameResult;

export type MatchConfig = {
    /** Preset deck id for seat A (e.g. "mono-red-burn"). */
    deckA: string;
    /** Preset deck id for seat B. */
    deckB: string;
    games: number;
    /** Base seed; game i uses seed + i, so a whole match is reproducible. */
    seed: number;
    budgetA: SearchBudget;
    budgetB: SearchBudget;
};

export type MatchReport = {
    config: MatchConfig;
    games: number;
    /** Games that ended in a real MTG result (life / decked / concede). */
    decisive: number;
    aWins: number;
    bWins: number;
    /** Non-terminal stops (stall / max-plies / resolution-error /
     *  search-error) — harness health, NOT draws. A healthy match keeps this
     *  at 0. */
    guardStops: number;
    /** Seat A win-rate over DECISIVE games (the headline number). 0.5 = even. */
    winRateA: number;
    /** Win-rate of whichever seat was on the play — sanity check on first-player
     *  advantage and on the harness itself (a wildly skewed value flags a bug). */
    onThePlayWinRate: number;
    avgTurns: number;
    avgPlies: number;
    /** Mean final material margin from A's perspective (signed; + = A ahead).
     *  Magnitude-of-victory signal that complements the binary win-rate. */
    avgMarginA: number;
    /** Count per end reason — guard reasons here mean games to investigate. */
    reasons: Record<GameEndReason, number>;
    wallClockMs: number;
};

const ZERO_REASONS = (): Record<GameEndReason, number> => ({
    life: 0,
    decked: 0,
    concede: 0,
    draw: 0,
    poison: 0,
    "alternate-win": 0,
    stall: 0,
    "max-plies": 0,
    "resolution-error": 0,
    "search-error": 0,
});

/** Run a full match. Pure given (config, clock): the only impurity is reading
 *  wall-clock for the duration metric, passed in so callers/tests control it. */
export function runMatch(
    config: MatchConfig,
    now: () => number,
    runGame: GameRunner = runHeadlessGame
): MatchReport {
    const start = now();
    const reasons = ZERO_REASONS();
    let aWins = 0;
    let bWins = 0;
    let guardStops = 0;
    let decisive = 0;
    let onThePlayWins = 0;
    let turnsSum = 0;
    let pliesSum = 0;
    let marginSum = 0;

    for (let i = 0; i < config.games; i++) {
        // Alternate who is on the play to cancel first-player advantage.
        const aOnPlay = i % 2 === 0;
        const aInput = presetToPlayerInput(config.deckA, aOnPlay ? 0 : 1, "A");
        const bInput = presetToPlayerInput(config.deckB, aOnPlay ? 1 : 0, "B");
        const players = aOnPlay ? [aInput, bInput] : [bInput, aInput];

        const state = createInitialGameState(players, config.seed + i);
        const result: GameResult = runGame(
            state,
            { id: "A", budget: config.budgetA },
            { id: "B", budget: config.budgetB },
            config.seed + i
        );

        reasons[result.reason]++;
        turnsSum += result.turns;
        pliesSum += result.plies;
        marginSum += result.marginA;

        if (result.winnerId === "A" || result.winnerId === "B") {
            decisive++;
            const onPlaySeat = aOnPlay ? "A" : "B";
            if (result.winnerId === onPlaySeat) onThePlayWins++;
            if (result.winnerId === "A") aWins++;
            else bWins++;
        } else {
            guardStops++;
        }
    }

    return {
        config,
        games: config.games,
        decisive,
        aWins,
        bWins,
        guardStops,
        winRateA: decisive > 0 ? aWins / decisive : 0,
        onThePlayWinRate: decisive > 0 ? onThePlayWins / decisive : 0,
        avgTurns: config.games > 0 ? turnsSum / config.games : 0,
        avgPlies: config.games > 0 ? pliesSum / config.games : 0,
        avgMarginA: config.games > 0 ? marginSum / config.games : 0,
        reasons,
        wallClockMs: now() - start,
    };
}

/** Human-readable one-screen summary of a match report. */
export function formatReport(r: MatchReport): string {
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const lines = [
        `Match: A=${r.config.deckA} vs B=${r.config.deckB}  (${r.games} games, seed ${r.config.seed})`,
        `  budgets: A=${JSON.stringify(r.config.budgetA)}  B=${JSON.stringify(r.config.budgetB)}`,
        `  decisive: ${r.decisive}/${r.games}   guard stops: ${r.guardStops}`,
        `  win-rate A: ${pct(r.winRateA)}  (A ${r.aWins} – ${r.bWins} B)`,
        `  on-the-play win-rate: ${pct(r.onThePlayWinRate)}`,
        `  avg turns: ${r.avgTurns.toFixed(1)}   avg plies: ${r.avgPlies.toFixed(0)}`,
        `  avg margin A: ${r.avgMarginA >= 0 ? "+" : ""}${r.avgMarginA.toFixed(0)}`,
        `  end reasons: ${Object.entries(r.reasons)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => `${k}=${n}`)
            .join("  ")}`,
        `  wall-clock: ${(r.wallClockMs / 1000).toFixed(1)}s  (${(r.wallClockMs / r.games).toFixed(0)}ms/game)`,
    ];
    return lines.join("\n");
}
