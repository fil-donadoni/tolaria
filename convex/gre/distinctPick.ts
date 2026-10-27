/** Pairwise-distinct pick legality (CR 701.23a) — the shared, PURE core of
 *  `choice { kind: "search-library", distinctBy }` (issue #6475).
 *
 *  A search for "up to four cards with different names" (Gifts Ungiven) or
 *  "creature cards with different powers" (Threats Undetected) adds a
 *  description on the SET of found cards, not on each card: no two picks may
 *  share the characteristic. CR 701.23a — "find a card that matches the given
 *  description" — and CR 701.23b (the searcher may find fewer, or none, since
 *  the zone is hidden) make `count` a ceiling, never a floor.
 *
 *  Like `categorizedPick.ts`, a LEAF module: ids and the per-card key in,
 *  booleans and numbers out — no `GameState`, no card registry. The SAME code
 *  backs the server submit validation (`pendingChoiceSubmitHandlers`), the
 *  Op's own `count` ceiling (`interpreter`), the client's per-card click gate
 *  (`player-library.tsx`) and the Bot's candidate generator, so no surface
 *  holds a re-derived copy that could drift.
 *
 *  `keys` maps a candidate card's instance id to its comparison key, resolved
 *  ONCE when the choice is raised (the card's name, CR 201.2, or its power as
 *  the search sees it, stringified). A card with NO entry has no such
 *  characteristic — a noncreature has no power (CR 208.3) — and so can never
 *  satisfy the description: it is not eligible at all. */
export type DistinctKeys = Readonly<Record<string, string>>;

/** The cards that may be picked at all: those that HAVE a key, in the order
 *  the key table lists them. */
export function distinctEligibleIds(keys: DistinctKeys): string[] {
    return Object.keys(keys);
}

/** The MOST cards a legal pick can hold — the number of distinct keys. Drives
 *  the choice's `count.max` (CR 608.2b: never offer a pick that cannot be
 *  made); the searcher may still find fewer (CR 701.23b). */
export function maxDistinctPicks(keys: DistinctKeys): number {
    return new Set(Object.values(keys)).size;
}

/** Is `picks` legal? Every pick must be an eligible card, none picked twice,
 *  and no two sharing a key. An empty set is always legal (CR 701.23b). */
export function isDistinctPickLegal(
    keys: DistinctKeys,
    picks: readonly string[]
): boolean {
    const seenIds = new Set<string>();
    const seenKeys = new Set<string>();
    for (const id of picks) {
        const key = keys[id];
        if (key === undefined || seenIds.has(id) || seenKeys.has(key)) {
            return false;
        }
        seenIds.add(id);
        seenKeys.add(key);
    }
    return true;
}

/** Can `cardId` be ADDED to `picks` and leave a legal set? The client's
 *  per-card click gate and the Bot's greedy prefix test. Re-picking an
 *  already-picked card is a deselect, not an add, so it returns false. */
export function canAddDistinctPick(
    keys: DistinctKeys,
    picks: readonly string[],
    cardId: string
): boolean {
    if (picks.includes(cardId)) return false;
    return isDistinctPickLegal(keys, [...picks, cardId]);
}
