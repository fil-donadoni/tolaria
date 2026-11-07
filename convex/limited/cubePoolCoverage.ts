/**
 * Vintage Cube pool completeness (issue #8274): every id of the implemented
 * pool owns a Card Profile (`data/card-profiles/vintage-cube.json`) AND a Pick
 * Rating (`data/pick-ratings/vintage-cube.json`). Pure — the caller hands in
 * the pool and the two files' keys.
 *
 * `scripts/check-cube-ratings.ts` scans hand-written SOURCE so a card PR sees
 * a missing rating before the lane; this is the pool-wide half, over compiled
 * (`ready`) cards too, and it covers profiles.
 */

export interface CubePoolCoverageGaps {
    readonly unprofiled: readonly string[];
    readonly unrated: readonly string[];
}

export function cubePoolCoverageGaps(
    pool: readonly string[],
    profiles: Readonly<Record<string, unknown>>,
    ratings: Readonly<Record<string, unknown>>
): CubePoolCoverageGaps {
    return {
        unprofiled: pool.filter((id) => profiles[id] === undefined),
        unrated: pool.filter((id) => ratings[id] === undefined),
    };
}
