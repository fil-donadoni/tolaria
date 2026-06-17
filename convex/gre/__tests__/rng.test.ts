import { describe, it, expect } from "vitest";
import { nextRandom, randomInt, seededShuffle } from "../rng";
import type { GameState } from "../state";

function state(seed: number): GameState {
    return {
        players: [],
        stack: [],
        turn: 1,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        passCount: 0,
        phase: "PRECOMBAT_MAIN",
        rngSeed: seed,
        rngCounter: 0,
    };
}

describe("PRNG determinism (CR 707, replay)", () => {
    it("produces identical sequences for the same seed", () => {
        const a = state(12345);
        const b = state(12345);
        const seqA = Array.from({ length: 10 }, () => nextRandom(a));
        const seqB = Array.from({ length: 10 }, () => nextRandom(b));
        expect(seqA).toEqual(seqB);
    });

    it("produces different sequences for different seeds", () => {
        const a = state(1);
        const b = state(2);
        expect(nextRandom(a)).not.toBe(nextRandom(b));
    });

    it("advances rngCounter monotonically", () => {
        const s = state(42);
        nextRandom(s);
        nextRandom(s);
        nextRandom(s);
        expect(s.rngCounter).toBe(3);
    });

    it("randomInt stays in [0, n)", () => {
        const s = state(7);
        for (let i = 0; i < 100; i++) {
            const v = randomInt(s, 5);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(5);
        }
    });

    it("seededShuffle is reproducible across runs", () => {
        const a = state(999);
        const b = state(999);
        const arrA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const arrB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        seededShuffle(a, arrA);
        seededShuffle(b, arrB);
        expect(arrA).toEqual(arrB);
    });

    it("seededShuffle produces a permutation", () => {
        const s = state(13);
        const arr = [1, 2, 3, 4, 5];
        seededShuffle(s, arr);
        expect(arr.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    });
});

// Coin flips (CR 705) route through `randomInt(state, 2)` — the exact
// substrate `SpellContext.flipCoin` wraps (1 = heads/win, 0 = tails/lose).
// These assert that the flip stream is reproducible given the seed, which is
// what replay safety for Bottle of Suleiman / Mijae / Ydwen depends on.
describe("coin flip determinism (CR 705, replay)", () => {
    // flipCoin() === randomInt(state, 2) === 1
    const flip = (s: GameState): boolean => randomInt(s, 2) === 1;

    it("produces an identical flip sequence for the same seed", () => {
        const a = state(2024);
        const b = state(2024);
        const seqA = Array.from({ length: 20 }, () => flip(a));
        const seqB = Array.from({ length: 20 }, () => flip(b));
        expect(seqA).toEqual(seqB);
    });

    it("each flip is a boolean and the counter advances per flip", () => {
        const s = state(55);
        const first = flip(s);
        expect(typeof first).toBe("boolean");
        expect(s.rngCounter).toBe(1);
        flip(s);
        expect(s.rngCounter).toBe(2);
    });

    it("different seeds diverge across the flip stream", () => {
        const a = state(1);
        const b = state(987654);
        const seqA = Array.from({ length: 20 }, () => flip(a));
        const seqB = Array.from({ length: 20 }, () => flip(b));
        expect(seqA).not.toEqual(seqB);
    });

    it("yields both outcomes over a run (not stuck on one face)", () => {
        const s = state(31337);
        const results = Array.from({ length: 40 }, () => flip(s));
        expect(results).toContain(true);
        expect(results).toContain(false);
    });
});
