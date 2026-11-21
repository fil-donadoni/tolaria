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

/**
 * Bin `part` (0-based) of a cost-balanced split of `items` into `parts` bins
 * (issue #10319), in the items' original order.
 *
 * Longest-processing-time greedy: heaviest item first onto the lightest bin,
 * ties to the earlier item and the lower bin, so the split is deterministic
 * and every caller computing bin `part` agrees on it. The robustness audit's
 * CI parts use it: one entry costs from a few to ~70k search iterations, so an
 * index-modulo split leaves one part far behind the others.
 */
export function costBalancedSlice<T>(
    items: readonly T[],
    part: number,
    parts: number,
    cost: (item: T) => number
): T[] {
    if (!Number.isInteger(parts) || parts < 1)
        throw new Error(`costBalancedSlice: parts must be >= 1, got ${parts}`);
    if (!Number.isInteger(part) || part < 0 || part >= parts)
        throw new Error(
            `costBalancedSlice: part must be in [0, ${parts}), got ${part}`
        );
    const order = items
        .map((item, index) => ({ index, cost: cost(item) }))
        .sort((a, b) => b.cost - a.cost || a.index - b.index);
    const load = new Array<number>(parts).fill(0);
    const binOf = new Array<number>(items.length);
    for (let i = 0; i < order.length; i++) {
        const { index, cost: c } = order[i];
        let bin = 0;
        for (let b = 1; b < parts; b++) if (load[b] < load[bin]) bin = b;
        load[bin] += c;
        binOf[index] = bin;
    }
    return items.filter((_, index) => binOf[index] === part);
}

/**
 * `"i/N"` (0 <= i < N) → `{ part: i, parts: N }`; unset or empty → `null`.
 * Anything else throws: a part selector must never quietly widen or narrow
 * the audit (issue #10319).
 */
export function parseBladePart(
    raw: string | undefined
): { part: number; parts: number } | null {
    if (raw === undefined || raw === "") return null;
    const m = /^(\d+)\/(\d+)$/.exec(raw);
    const part = m ? Number(m[1]) : NaN;
    const parts = m ? Number(m[2]) : NaN;
    if (!m || parts < 1 || part >= parts)
        throw new Error(
            `blade part must be "i/N" with 0 <= i < N, got "${raw}"`
        );
    return { part, parts };
}
