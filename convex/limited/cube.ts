// Vintage Cube pool-as-source Booster path (ADR 0062). A cube is NOT a set:
// it's a curated card POOL shuffled into random 15-card packs, so it has no
// print sheets, no rarity slots, and — deliberately — NO per-set completeness
// gate (the ≥80% per-sheet Draftability floor, ADR 0059, does not apply). The
// pool is the IMPLEMENTED SUBSET of the canonical Vintage Cube list: every
// name in `VINTAGE_CUBE_NAMES` (`convex/cubes/vintageCubeNames.ts`, the single
// source of truth generated from `data/worklists/vintage-cube.txt`) that
// resolves to an implemented
// `CardDefinition` via the SAME registry seam the set path uses — so the cube
// "just works" from day one with whatever cube cards are built, growing
// automatically as more land.
//
// Sampling (ADR 0062): the pool is shuffled once (seeded, deterministic) and
// dealt as SINGLETON 15-card packs — each card appears at most once across the
// entire draft. "One copy per card, maximum" is a HARD invariant, so a table
// that can't be filled singleton from the implemented pool is capped at
// creation (`maxCubeSeats`, enforced by `createLimitedEvent`) rather than
// dealt with-replacement — the cap lifts automatically as cube cards land.
// `dealCubeRoundPacks` THROWS rather than wrapping when a deal would overflow
// the pool: the old with-replacement "top-up" silently dealt the same card
// twice (it is what produced the Draft Lab's 8-seat duplicates), and a hard
// invariant that degrades quietly is not an invariant.
//
// The pool a draft deals from is FROZEN ON THE EVENT at start
// (`limitedEvents.cubePool`), never rebuilt per round from the live registry.
// The singleton invariant rests on all rounds slicing ONE shuffle, but round 0
// is dealt in `startLimitedEvent` and rounds 1+ in later `submitPick`
// invocations — so implementing a single cube card between them would change
// `pool.length`, reshuffle the whole permutation, and make the later rounds'
// slices overlap the earlier ones (cards already picked reappearing in a later
// pack). Callers pass the frozen array down through `startDraft`/`applyPick`;
// `buildCubePool()` is only ever read to CREATE that snapshot.
import { VINTAGE_CUBE_NAMES } from "../cubes/vintageCubeNames";
import { tryGetCardByName } from "../cards";
import { makeRng, shuffleWithRng } from "../gre/rng";

// The cube's identity (key, display name, predicate) lives in the dependency-
// free `cubeSource.ts` so UI code can name the source without pulling the pool
// (and, through it, the whole card registry) into the client bundle. Re-
// exported here so this module remains the one import site for cube semantics.
export { CUBE_SOURCE_KEY, CUBE_DISPLAY_NAME, isCubeSource } from "./cubeSource";

/** Cards per cube pack (a real cube deals random 15-card boosters). */
export const CUBE_PACK_SIZE = 15;

/** The canonical Vintage Cube list as card NAMES — the single source of truth
 *  `convex/cubes/vintageCubeNames.ts` (`VINTAGE_CUBE_NAMES`), generated from
 *  `data/worklists/vintage-cube.txt`. Names, not ids, because the worklist is
 *  the human-maintained source and a name resolves to whichever printing the
 *  engine has implemented. */
export const CUBE_CARD_NAMES: readonly string[] = VINTAGE_CUBE_NAMES;

let cachedPool: readonly string[] | null = null;

/** Builds the cube pool: every canonical cube name that resolves to an
 *  implemented `CardDefinition`, mapped to its canonical Card ID (`def.id`,
 *  the same id space `resolveCardMeta`/`getCardEvalMeta` resolve — a cube pack
 *  card carries `def.id` as its `scryfallId`, and `resolveDeckCardMeta`
 *  resolves it back to name/rarity for the Pool entry and the Bot Drafter).
 *  Unimplemented names are simply absent — the "implemented subset" the cube
 *  runs on (ADR 0062). Memoized: the registry is static, so the pool is a pure
 *  function of it. Deduplicated by id (defensive — two cube names resolving to
 *  the same printing would otherwise double a card in the singleton pool). */
export function buildCubePool(): readonly string[] {
    if (cachedPool) return cachedPool;
    const pool: string[] = [];
    const seen = new Set<string>();
    for (const name of CUBE_CARD_NAMES) {
        const def = tryGetCardByName(name);
        if (!def) continue;
        if (seen.has(def.id)) continue;
        seen.add(def.id);
        pool.push(def.id);
    }
    cachedPool = pool;
    return pool;
}

/** The implemented cube pool size N — surfaced to the create-event UI as
 *  "Cube: N cards available" (never an Incompleteness "N missing" disable:
 *  a cube is curated, not a set to complete). */
export function cubePoolSize(): number {
    return buildCubePool().length;
}

/** Whether a full draft of `roundCount` rounds at `seatCount` seats can be
 *  dealt SINGLETON (every card at most once) from a pool of `poolSize`, or
 *  overflows it. "top-up" is the historical name of the WITH-REPLACEMENT
 *  fallback (ADR 0062) — that fallback is GONE: a deal in this regime now
 *  throws in `dealCubeRoundPacks`. The predicate survives as the cheap
 *  up-front check callers use to size a table (`maxCubeSeats` is its inverse)
 *  and to refuse an oversized config before dealing anything. */
export function cubeSampleRegime(
    poolSize: number,
    seatCount: number,
    packSize: number,
    roundCount: number
): "singleton" | "top-up" {
    return poolSize >= seatCount * packSize * roundCount
        ? "singleton"
        : "top-up";
}

/** The largest seat count a SINGLETON cube draft of `roundCount` rounds can
 *  serve from `poolSize` cards at `packSize` per pack —
 *  `floor(poolSize / (packSize × roundCount))`. The cube caps the table here
 *  (`createLimitedEvent`, ADR 0062 rev) rather than duplicating cards:
 *  "one copy per card, maximum" is a hard invariant, so a config that would
 *  overflow the implemented pool is rejected at creation instead of dealt
 *  with-replacement. Grows automatically toward the full table as cube cards
 *  are implemented (283 → 360 cards lifts the 3-round cap from 6 to 8 seats).
 *  Returns 0 for a degenerate `packSize`/`roundCount` of 0. */
export function maxCubeSeats(
    poolSize: number,
    packSize: number,
    roundCount: number
): number {
    if (packSize <= 0 || roundCount <= 0) return 0;
    return Math.floor(poolSize / (packSize * roundCount));
}

/** Seeded Fisher-Yates shuffle of a COPY of `pool` using `makeRng(seed)` — the
 *  same seeded-PRNG convention the rest of the draft engine shares
 *  (`convex/gre/rng.ts`, whose `shuffleWithRng` does the actual shuffling —
 *  this function just owns the `seed -> rng` step). Pure: the same
 *  `(pool, seed)` always yields the same order, which is what makes the whole
 *  cube draft reproducible from the one seed stored on the event row. */
export function shuffleCube(pool: readonly string[], seed: number): string[] {
    return shuffleWithRng(pool, makeRng(seed));
}

/** Deals one round of cube packs: `seatCount` packs of `packSize` cards each,
 *  as canonical Card IDs. Deterministic from `(pool, seed, round)` — `seed` is
 *  the EVENT seed (NOT a per-round-derived seed): the pool is shuffled once and
 *  each round consumes a disjoint contiguous slice of that single shuffle
 *  (`round * seatCount * packSize` as the starting cursor). That is what makes
 *  the SINGLETON invariant hold ACROSS rounds — no index is ever revisited, so
 *  no card appears twice in the entire draft.
 *
 *  Two things the invariant rests on, both enforced rather than assumed:
 *
 *  1. `pool` must be big enough for the whole draft. A round whose slice would
 *     run past the end THROWS — it used to wrap (`% pool.length`) and top the
 *     shortfall up WITH-REPLACEMENT, which is exactly how the same card got
 *     dealt twice. Callers size the table with `maxCubeSeats` up front
 *     (`createLimitedEvent`; the Draft Lab clamps its own seat count) so this
 *     throw is unreachable from any legitimate configuration.
 *  2. `pool` must be the SAME array for every round of one draft — the FROZEN
 *     snapshot stored on the event, never a fresh `buildCubePool()` per round
 *     (see this module's header). A pool that gains or loses one card between
 *     rounds reshuffles the entire permutation, and the later slices stop
 *     being disjoint from the earlier ones. */
export function dealCubeRoundPacks(
    pool: readonly string[],
    seatCount: number,
    packSize: number,
    round: number,
    seed: number
): string[][] {
    if (pool.length === 0) {
        throw new Error("dealCubeRoundPacks: cube pool is empty");
    }
    const shuffled = shuffleCube(pool, seed);
    const start = round * seatCount * packSize;
    const end = start + seatCount * packSize;
    if (end > shuffled.length) {
        throw new Error(
            `dealCubeRoundPacks: cube pool of ${shuffled.length} cards cannot deal round ${round} for ${seatCount} seats at ${packSize} cards per pack (needs ${end}). A cube is singleton — size the table with maxCubeSeats instead of repeating cards.`
        );
    }
    const packs: string[][] = [];
    let cursor = start;
    for (let s = 0; s < seatCount; s++) {
        const pack: string[] = [];
        while (pack.length < packSize) {
            pack.push(shuffled[cursor]);
            cursor++;
        }
        packs.push(pack);
    }
    return packs;
}
