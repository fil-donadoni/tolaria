import { describe, it, expect } from "vitest";
import { playLadderGame, type LadderGameSpec } from "./ladder";
import { getSearchVariant } from "@convex/gre/ai/searchVariant";

/**
 * Ladder game runner micro smoke (issue #1924, decision #1895). ONE pairing at
 * a TINY iteration budget — never the production 400 (a real run is `bun run
 * ladder`, a CLI, precisely because it does not belong in a test suite). What
 * is pinned here is the harness contract, not strength:
 *
 *   * a (spec, variant) pair is bit-reproducible (decision #1895 §2);
 *   * candidateWon is consistent with winnerSeat/candidateSeat;
 *   * the variant seam is always cleaned up after a game.
 */

const SPEC: LadderGameSpec = {
    deckSeat0: "mono-red-burn",
    deckSeat1: "white-weenie",
    seed: 11,
    candidateSeat: "S1",
    iterations: 6,
};

describe("playLadderGame (micro smoke)", () => {
    it("plays a full headless game and reports a consistent outcome", () => {
        const out = playLadderGame(SPEC, null);
        expect(out.plies).toBeGreaterThan(0);
        expect(out.turns).toBeGreaterThan(0);
        if (out.winnerSeat === null) {
            expect(out.candidateWon).toBeNull();
        } else {
            expect(out.candidateWon).toBe(
                out.winnerSeat === SPEC.candidateSeat
            );
        }
    });

    it("is bit-reproducible: same spec + variant, identical outcome", () => {
        const a = playLadderGame(SPEC, null);
        const b = playLadderGame(SPEC, null);
        expect(b).toEqual(a);
    });

    it("the paired orientation replays the same shuffles with agents swapped", () => {
        // Same seed and seating, only candidateSeat differs — with a NULL
        // candidate both games are pure control, so the game itself must be
        // identical and only the candidate attribution flips.
        const o0 = playLadderGame(SPEC, null);
        const o1 = playLadderGame({ ...SPEC, candidateSeat: "S0" }, null);
        expect(o1.winnerSeat).toBe(o0.winnerSeat);
        expect(o1.turns).toBe(o0.turns);
        expect(o1.plies).toBe(o0.plies);
        if (o0.candidateWon !== null) {
            expect(o1.candidateWon).toBe(!o0.candidateWon);
        }
    });

    it("runs a real candidate variant deterministically and cleans the seam up", () => {
        const variant = { name: "ucb-tight", ucbC: 0.7 };
        const a = playLadderGame(SPEC, variant);
        const b = playLadderGame(SPEC, variant);
        expect(b).toEqual(a);
        expect(getSearchVariant()).toBeNull();
    });
});

/**
 * Cross-game isolation (issue #2681) — the safety argument the ladder's
 * process-per-worker parallelism rests on: `playLadderGame`'s only cross-call
 * seam (`setSearchVariant`) is installed → used → cleared in a `finally`
 * around EACH call, so distinct games never share state through it. This is
 * provable IN-PROCESS by shuffling the call order across several distinct
 * specs and confirming each spec's outcome never depends on what ran before
 * or after it — a real multi-process worker changes only WHICH OS process a
 * game runs in, never this per-call contract, so proving it here licenses
 * the parallel design without needing to spawn real subprocesses in a test.
 */
describe("playLadderGame: cross-game isolation (issue #2681)", () => {
    const SPECS: LadderGameSpec[] = [
        {
            deckSeat0: "mono-red-burn",
            deckSeat1: "white-weenie",
            seed: 11,
            candidateSeat: "S1",
            iterations: 6,
        },
        {
            deckSeat0: "mono-red-burn",
            deckSeat1: "white-weenie",
            seed: 12,
            candidateSeat: "S0",
            iterations: 6,
        },
        {
            deckSeat0: "white-weenie",
            deckSeat1: "mono-green-stompy",
            seed: 5,
            candidateSeat: "S1",
            iterations: 6,
        },
    ];
    const VARIANTS = [null, { name: "ucb-tight", ucbC: 0.7 }, null];

    /** Play the specs at the given original-index order, return outcomes
     *  keyed back by that original index (never by call position). */
    function playInOrder(order: number[]): Map<number, unknown> {
        const out = new Map<number, unknown>();
        for (const i of order)
            out.set(i, playLadderGame(SPECS[i], VARIANTS[i]));
        return out;
    }

    it("each spec's outcome is independent of the order games are played in", () => {
        const baseline = playInOrder([0, 1, 2]);
        const reversed = playInOrder([2, 1, 0]);
        const interleaved = playInOrder([1, 0, 2]);

        for (let i = 0; i < SPECS.length; i++) {
            expect(reversed.get(i)).toEqual(baseline.get(i));
            expect(interleaved.get(i)).toEqual(baseline.get(i));
        }

        // The seam is always clean afterward, whatever order it ran in.
        expect(getSearchVariant()).toBeNull();
    });
});
