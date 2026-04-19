// Deterministic PRNG for replay support.
// Seed + counter live on GameState. Every consumer goes through `nextRandom`,
// which advances the counter and derives the next float from (seed, counter).
// Replay a game by re-running events against the same initial seed.

import type { GameState } from "./state";

/** Mulberry32 finalizer applied to a seed-derived 32-bit integer.
 *  Stateless: same (seed, counter) → same float in [0, 1). */
function sample(seed: number, counter: number): number {
    const a = (seed + Math.imul(counter, 0x6d2b79f5)) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Generates a seed for a new game from the environment.
 *  Stored on GameState.rngSeed and logged on GAME_INITIALIZED for replay. */
export function freshSeed(): number {
    return (Math.random() * 0x100000000) | 0;
}

/** Advance the PRNG on `state` and return a float in [0, 1). */
export function nextRandom(state: GameState): number {
    state.rngCounter = (state.rngCounter + 1) | 0;
    return sample(state.rngSeed, state.rngCounter);
}

/** Integer in [0, n). `n` must be a positive integer. */
export function randomInt(state: GameState, n: number): number {
    if (n <= 0) throw new Error("randomInt: n must be positive");
    return Math.floor(nextRandom(state) * n);
}

/** Fisher–Yates shuffle using the state's PRNG. Mutates `array`. */
export function seededShuffle<T>(state: GameState, array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = randomInt(state, i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
