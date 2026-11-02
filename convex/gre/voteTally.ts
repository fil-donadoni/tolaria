// CR 701.38 (issue #2071) — the outcome of a vote, as a pure function of the
// votes cast. The `vote` Effect Op collects one vote per player and binds what
// this returns; the Op after it acts on the result.

/** The choices with the MOST votes or TIED for most ("each permanent with the
 *  most votes or tied for most votes" — Council's Judgment). Every vote names
 *  one choice id; the result lists each winning id once, in the order its
 *  first vote was cast, so the binding is deterministic. No votes → no
 *  winners. In a two-player game two different votes are a 1–1 tie, so BOTH
 *  win: the normal case, not an edge case. */
export function tallyVotes(votes: readonly string[]): string[] {
    const counts = new Map<string, number>();
    for (const vote of votes) counts.set(vote, (counts.get(vote) ?? 0) + 1);
    let most = 0;
    for (const count of counts.values()) most = Math.max(most, count);
    return [...counts].filter(([, count]) => count === most).map(([id]) => id);
}
