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

/** A self-contained seeded float stream in [0, 1), independent of any
 *  GameState. Used by the AI search (issue #112): ISMCTS must be reproducible
 *  given a seed without perturbing the game's own `rngSeed`/`rngCounter`. Each
 *  returned closure owns its counter, so two streams from the same seed produce
 *  the same sequence. */
export function makeRng(seed: number): () => number {
    let counter = 0;
    return () => {
        counter = (counter + 1) | 0;
        return sample(seed, counter);
    };
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

/** Fisher–Yates shuffle over an injected float stream (`makeRng`'s closure
 *  shape, not a `GameState`), returning a NEW array — `items` is left
 *  untouched. The single shared implementation for every call site that
 *  shuffles off a self-contained `rng` stream rather than a `GameState`:
 *  `gre/determinize.ts` (ISMCTS world sampling), `limited/cube.ts` (cube pack
 *  dealing) and `limited/swiss.ts` (score-bucket pairing order) had each grown
 *  a byte-identical copy of this loop — extracted here per the project's
 *  extract-on-the-second-copy rule. Pure: the same `(items, rng)` sequence
 *  always yields the same order. */
export function shuffleWithRng<T>(items: readonly T[], rng: () => number): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
