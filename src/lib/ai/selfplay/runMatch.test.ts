// Unit tests for the match-report seat/turn accounting (issue #243).
//
// The on-the-play win-rate is the headline first-player-advantage signal, so
// its bookkeeping must be exactly right: the seat on the play ALTERNATES every
// game (A on even games, B on odd games), and `onThePlayWinRate` must credit
// whichever seat actually started that game — not always seat A. A bug here
// would make a perfectly even engine look skewed (the symptom investigated in
// #243). These tests inject a deterministic game runner so the accounting is
// verified without a full ISMCTS game.

import { describe, it, expect } from "vitest";
import { runMatch, type GameRunner, type MatchConfig } from "./runMatch";
import type { GameResult } from "./playGame";

const CONFIG = (games: number): MatchConfig => ({
    deckA: "mono-red-burn",
    deckB: "mono-red-burn",
    games,
    seed: 1,
    budgetA: { iterations: 1 },
    budgetB: { iterations: 1 },
});

const clock = () => 0;

/** The seat on the play in game `i` is the one passed at `players[0]`, which
 *  `runMatch` arranges as A on even games and B on odd games. The runner can't
 *  see the game index, but `state.players[0].id` IS the on-the-play seat — so a
 *  runner that reads it can decide outcomes by seat position deterministically. */
function makeRunner(
    decide: (onPlaySeat: string) => Partial<GameResult>
): GameRunner {
    return (state): GameResult => {
        const onPlaySeat = state.players[0].id;
        const base: GameResult = {
            winnerId: null,
            loserId: null,
            reason: "life",
            turns: 5,
            plies: 10,
            marginA: 0,
        };
        return { ...base, ...decide(onPlaySeat) };
    };
}

describe("runMatch on-the-play accounting (issue #243)", () => {
    it("reports 100% when the seat ON THE PLAY always wins, regardless of A/B", () => {
        // Whoever is at players[0] (the on-the-play seat) wins every game. Since
        // the seat alternates, this means A wins even games and B wins odd ones.
        const runner = makeRunner((onPlaySeat) => ({
            winnerId: onPlaySeat,
            loserId: onPlaySeat === "A" ? "B" : "A",
        }));
        const r = runMatch(CONFIG(10), clock, runner);

        expect(r.decisive).toBe(10);
        expect(r.guardStops).toBe(0);
        // On the play wins every decisive game.
        expect(r.onThePlayWinRate).toBe(1);
        // Overall A/B win-rate is even (each was on the play half the games),
        // which is the whole point of alternating seats.
        expect(r.aWins).toBe(5);
        expect(r.bWins).toBe(5);
        expect(r.winRateA).toBe(0.5);
    });

    it("reports 0% when the seat ON THE DRAW always wins (mirror of the above)", () => {
        const runner = makeRunner((onPlaySeat) => {
            const onDraw = onPlaySeat === "A" ? "B" : "A";
            return { winnerId: onDraw, loserId: onPlaySeat };
        });
        const r = runMatch(CONFIG(10), clock, runner);

        expect(r.decisive).toBe(10);
        expect(r.onThePlayWinRate).toBe(0);
        // Still even between A and B.
        expect(r.aWins).toBe(5);
        expect(r.bWins).toBe(5);
    });

    it("treats guard stops as non-decisive and excludes them from win-rates", () => {
        // Even games: a real life win for the on-play seat. Odd games: a
        // search-error guard stop (no winner).
        let game = -1;
        const runner: GameRunner = (state): GameResult => {
            game++;
            const base: GameResult = {
                winnerId: null,
                loserId: null,
                reason: "life",
                turns: 5,
                plies: 10,
                marginA: 0,
            };
            if (game % 2 === 1) {
                return { ...base, reason: "search-error" };
            }
            const onPlaySeat = state.players[0].id;
            return {
                ...base,
                winnerId: onPlaySeat,
                loserId: onPlaySeat === "A" ? "B" : "A",
            };
        };
        const r = runMatch(CONFIG(10), clock, runner);

        expect(r.decisive).toBe(5);
        expect(r.guardStops).toBe(5);
        expect(r.reasons["search-error"]).toBe(5);
        // Win-rates are over DECISIVE games only — the 5 guard stops don't dilute.
        expect(r.onThePlayWinRate).toBe(1);
        // Decisive games here are all even games (A on the play) → all A wins.
        expect(r.aWins).toBe(5);
        expect(r.bWins).toBe(0);
        expect(r.winRateA).toBe(1);
    });

    it("an even engine (on-play wins half) reports ~50% on-the-play", () => {
        // Decide by game index parity via a counter: on-play seat wins half.
        let game = -1;
        const runner: GameRunner = (state): GameResult => {
            game++;
            const onPlaySeat = state.players[0].id;
            const onDraw = onPlaySeat === "A" ? "B" : "A";
            const winner = game % 2 === 0 ? onPlaySeat : onDraw;
            return {
                winnerId: winner,
                loserId: winner === "A" ? "B" : "A",
                reason: "life",
                turns: 5,
                plies: 10,
                marginA: 0,
            };
        };
        const r = runMatch(CONFIG(20), clock, runner);

        expect(r.decisive).toBe(20);
        expect(r.onThePlayWinRate).toBe(0.5);
    });
});
