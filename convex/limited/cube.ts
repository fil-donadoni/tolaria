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
// entire draft — whenever the pool is large enough (≥ seats × 15 × rounds).
// When it isn't (a still-small implemented pool), the shortfall is topped up
// WITH-REPLACEMENT rather than hard-blocking: honoring "no minimum — must work
// from day one", a draft still runs at any pool size (the "small-pool top-up"
// regime, surfaced by `cubeSampleRegime`).
import { VINTAGE_CUBE_NAMES } from "../cubes/vintageCubeNames";
import { tryGetCardByName } from "../cards";
import { makeRng } from "../gre/rng";

/** Reserved Pack Source key that the draft pipeline recognizes as the cube
 *  (never a real set code — `getBoosterConfig` returns null for it, and
 *  `isDraftableSet`/`generateRoundPacks` special-case it BEFORE any per-set
 *  Booster Config lookup). */
export const CUBE_SOURCE_KEY = "vintage-cube";

/** Human-facing Pack Source label (all UI text is English, CLAUDE.md). */
export const CUBE_DISPLAY_NAME = "Vintage Cube";

/** Cards per cube pack (a real cube deals random 15-card boosters). */
export const CUBE_PACK_SIZE = 15;

/** Whether `setCode` names the cube source (case-insensitive, mirroring the
 *  set-code case handling in `registry.ts`'s `getBoosterConfig`). */
export function isCubeSource(setCode: string): boolean {
    return setCode.toLowerCase() === CUBE_SOURCE_KEY;
}

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
 *  must fall back to the WITH-REPLACEMENT "top-up" regime (ADR 0062). A draft
 *  runs in either regime — this only names which one, for logging/surfacing. */
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

/** Seeded Fisher-Yates shuffle of a COPY of `pool` using `makeRng(seed)` — the
 *  same seeded-PRNG convention the rest of the draft engine shares
 *  (`convex/gre/rng.ts`). Pure: the same `(pool, seed)` always yields the same
 *  order, which is what makes the whole cube draft reproducible from the one
 *  seed stored on the event row. */
export function shuffleCube(pool: readonly string[], seed: number): string[] {
    const arr = [...pool];
    const rng = makeRng(seed);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/** Deals one round of cube packs: `seatCount` packs of `packSize` cards each,
 *  as canonical Card IDs. Deterministic from `(pool, seed, round)` — `seed` is
 *  the EVENT seed (NOT a per-round-derived seed): the pool is shuffled once and
 *  each round consumes a disjoint contiguous slice of that single shuffle
 *  (`round * seatCount * packSize` as the starting cursor). That is what makes
 *  the SINGLETON invariant hold ACROSS rounds — as long as the whole draft
 *  (`seatCount * packSize * roundCount` cards) fits within `pool.length`, no
 *  index is ever revisited, so no card appears twice in the entire draft.
 *
 *  When the pool is smaller, the cursor's `% pool.length` wraps: the shortfall
 *  is topped up WITH-REPLACEMENT (ADR 0062 — a still-small implemented pool
 *  still runs a draft rather than hard-blocking). Callers wanting to surface
 *  which regime is active check `cubeSampleRegime` up front. (A within-a-pack
 *  duplicate can only occur in the pathological case `pool.length < packSize`,
 *  which no real cube approaches.) */
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
    const packs: string[][] = [];
    let cursor = round * seatCount * packSize;
    for (let s = 0; s < seatCount; s++) {
        const pack: string[] = [];
        while (pack.length < packSize) {
            pack.push(shuffled[cursor % shuffled.length]);
            cursor++;
        }
        packs.push(pack);
    }
    return packs;
}
