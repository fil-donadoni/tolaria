// The cube's IDENTITY — its reserved Pack Source key, its display name, and
// the predicate that recognizes it — split out of `cube.ts` (ADR 0062) so a
// caller that only needs to NAME the source doesn't drag in the pool itself.
// `cube.ts` imports `VINTAGE_CUBE_NAMES` and the whole card registry to BUILD
// the pool; the UI only ever asks "is this pack source the cube, and what do I
// call it?", and a client bundle should not pay for the card catalogue to
// answer that. `cube.ts` re-exports everything here, so it stays the single
// authority for cube semantics — this file just carves out the cheap half.

/** Reserved Pack Source key that the draft pipeline recognizes as the cube
 *  (never a real set code — `getBoosterConfig` returns null for it, and
 *  `isDraftableSet`/`generateRoundPacks` special-case it BEFORE any per-set
 *  Booster Config lookup). */
export const CUBE_SOURCE_KEY = "vintage-cube";

/** Human-facing Pack Source label (all UI text is English, CLAUDE.md). */
export const CUBE_DISPLAY_NAME = "Vintage Cube";

/** Whether `setCode` names the cube source (case-insensitive, mirroring the
 *  set-code case handling in `registry.ts`'s `getBoosterConfig`). */
export function isCubeSource(setCode: string): boolean {
    return setCode.toLowerCase() === CUBE_SOURCE_KEY;
}
