/**
 * Blade spec sharding (issue #4482, PRD #4480).
 *
 * The `must` tier is ~158 entries of real ISMCTS search. Iterated by ONE spec
 * file it runs on one worker, serially (312 s measured, 2026-09-24) while the
 * other workers idle. The spec is therefore split into `BLADE_SHARDS` files
 * (`__tests__/blade.shard-N.spec.ts`), each iterating one slice of the tier
 * through the same runner.
 *
 * The partition is by ENTRY INDEX modulo the shard count: deterministic, no
 * per-entry table to keep in step with the registry, and adjacent entries —
 * which tend to share a family and therefore a cost — land on different
 * workers. `bladeShardOf` is the single authority; the spec runner and the
 * exhaustive/disjoint proof (`__tests__/bladeShard.bot.test.ts`) both go
 * through it.
 */

/** Number of blade spec files — one per worker the heavy tier grants. */
export const BLADE_SHARDS = 4;

/** The shard (0-based) that owns the entry at `index` of a tier's list. */
export function bladeShardOf(index: number, shards = BLADE_SHARDS): number {
    return index % shards;
}

/** The entries of `scenarios` that shard `shard` runs, in registry order. */
export function bladeShardSlice<T>(
    scenarios: readonly T[],
    shard: number,
    shards = BLADE_SHARDS
): T[] {
    return scenarios.filter(
        (_, index) => bladeShardOf(index, shards) === shard
    );
}
