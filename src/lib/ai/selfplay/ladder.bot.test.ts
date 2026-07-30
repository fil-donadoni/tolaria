import { describe, it, expect } from "vitest";
import { playLadderGame, type LadderGameSpec } from "./ladder";
import {
    getSearchVariant,
    setSearchVariant,
} from "@convex/gre/ai/searchVariant";

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

    it("samples one S0-perspective margin per turn (issue #1929)", () => {
        const out = playLadderGame(SPEC, null);
        expect(out.marginSamples.length).toBeGreaterThan(0);
        // One sample per sampled turn, strictly increasing turn numbers.
        const turns = out.marginSamples.map((s) => s.turn);
        expect(new Set(turns).size).toBe(turns.length);
        for (let i = 1; i < turns.length; i++) {
            expect(turns[i]).toBeGreaterThan(turns[i - 1]);
        }
        // Samples never exceed the game's reported turn count and every
        // margin is a finite evaluate value.
        expect(turns[turns.length - 1]).toBeLessThanOrEqual(out.turns);
        for (const s of out.marginSamples) {
            expect(Number.isFinite(s.margin)).toBe(true);
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
        // The margin trace is a property of the game, not of the candidate
        // attribution — identical across the pair (issue #1929).
        expect(o1.marginSamples).toEqual(o0.marginSamples);
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
 *
 * For this to be a real guard (not vacuous), SPECS[0]'s variant must
 * DEMONSTRABLY change SPECS[0]'s own outcome — otherwise no leak of it into
 * a neighbouring game could ever move that neighbour's result either, and
 * the order-equality assertions below would pass whether or not the seam
 * actually isolates. `ucbC: 0.05` on this exact (deck, seed, candidateSeat,
 * iterations) tuple was verified empirically to flip the winner outright
 * (S1 -> S0) versus the null variant; the assertion at the top of the test
 * pins that fact so a future engine change that made it stop mattering would
 * fail loudly here instead of silently making the rest of the test inert.
 */
describe("playLadderGame: cross-game isolation (issue #2681)", () => {
    const SPECS: LadderGameSpec[] = [
        {
            deckSeat0: "mono-red-burn",
            deckSeat1: "white-weenie",
            seed: 1,
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
    const VARIANTS = [{ name: "ucb-tight-lo", ucbC: 0.05 }, null, null];

    /** Play the specs at the given original-index order, return outcomes
     *  keyed back by that original index (never by call position). Asserts
     *  the seam is clean after EVERY individual game, not just at the very
     *  end — pins down which game (if any) leaves it dirty. */
    function playInOrder(order: number[]): Map<number, unknown> {
        const out = new Map<number, unknown>();
        for (const i of order) {
            out.set(i, playLadderGame(SPECS[i], VARIANTS[i]));
            expect(getSearchVariant()).toBeNull();
        }
        return out;
    }

    it("SPECS[0]'s variant demonstrably changes its own outcome (precondition — otherwise a leak of it could never be observed below)", () => {
        setSearchVariant(null);
        const withVariant = playLadderGame(SPECS[0], VARIANTS[0]);
        const withoutVariant = playLadderGame(SPECS[0], null);
        expect(withVariant).not.toEqual(withoutVariant);
    });

    it("each spec's outcome is independent of the order games are played in", () => {
        setSearchVariant(null); // hermetic: don't inherit residue from another test
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
