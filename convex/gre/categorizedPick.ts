/** Categorized-pick legality (CR 401.4 / 701.20a) — the shared, PURE core of
 *  the `revealAndCategorize` Op (issue #1364).
 *
 *  Some cards reveal a fixed window of library cards and then let the player
 *  keep **at most one card per category** from that ONE shared window, where a
 *  single card may qualify for several categories but can only ever be kept
 *  once:
 *
 *    Atraxa, Grand Unifier — "reveal the top ten cards of your library. For
 *    each card type, you may put a card of that type from among the revealed
 *    cards into your hand."
 *    (Gatherer ruling: a card with multiple card types can be chosen for only
 *    ONE of them.)
 *
 *  So a submitted pick set is legal exactly when there is an INJECTIVE
 *  assignment card → category with every card matching the category it is
 *  assigned to — a bipartite matching that saturates the picks (a "system of
 *  distinct representatives"). Greedy per-category assignment is NOT sound:
 *  an artifact creature grabbed for "Creature" can strand a plain creature
 *  that had no other category, so a set that a smarter assignment could seat
 *  gets rejected. This module runs the real matching (Kuhn's augmenting-path
 *  algorithm) instead.
 *
 *  It is deliberately a LEAF module: plain ids and buckets in, numbers and
 *  booleans out — no `GameState`, no `SpellContext`, no card registry. That is
 *  what lets the SAME code back the server-side submit validation
 *  (`pendingChoiceSubmit`), the Op's own `count` ceiling (`interpreter`), and
 *  the client's per-card click affordance (`player-library.tsx`) — one
 *  authority for "is this pick legal", never a re-derived client copy that can
 *  drift out of sync with the server and either offer an illegal pick or hide
 *  a legal one.
 *
 *  Sizes are tiny by construction (≤ the looked-at window, ≤ the category
 *  list — 10 × 8 for Atraxa), so the O(V·E) matching is free. */

/** One pick category, resolved against a concrete revealed window: `cardIds`
 *  is exactly the revealed cards that match this category's filter. Carried on
 *  the `PendingChoice` so the client can render the category and reuse the
 *  legality check without re-running `matchesCardFilter`. */
export interface PickCategory {
    /** Human label shown in the picker ("Creature", "Land", …). */
    label: string;
    /** The revealed card instance ids matching this category. */
    cardIds: readonly string[];
}

/** Kuhn's algorithm: try to find an augmenting path seating `cardIndex` into
 *  some category, displacing already-seated cards along the way. `seatedBy`
 *  maps category index → the card index currently holding it. */
function trySeat(
    adjacency: readonly number[][],
    cardIndex: number,
    seatedBy: (number | undefined)[],
    visited: boolean[]
): boolean {
    for (const category of adjacency[cardIndex]) {
        if (visited[category]) continue;
        visited[category] = true;
        const holder = seatedBy[category];
        if (
            holder === undefined ||
            trySeat(adjacency, holder, seatedBy, visited)
        ) {
            seatedBy[category] = cardIndex;
            return true;
        }
    }
    return false;
}

/** Size of the maximum matching between `cards` and `categories` — i.e. how
 *  many of `cards` can be kept simultaneously, at most one per category. */
function maximumMatching(
    categories: readonly PickCategory[],
    cards: readonly string[]
): number {
    const membership = categories.map((c) => new Set(c.cardIds));
    const adjacency = cards.map((id) =>
        membership.reduce<number[]>(
            (acc, set, i) => (set.has(id) ? [...acc, i] : acc),
            []
        )
    );
    const seatedBy: (number | undefined)[] = new Array(categories.length).fill(
        undefined
    );
    let matched = 0;
    for (let i = 0; i < cards.length; i++) {
        if (
            trySeat(
                adjacency,
                i,
                seatedBy,
                new Array(categories.length).fill(false)
            )
        )
            matched++;
    }
    return matched;
}

/** Every distinct card id appearing in at least one category — the set of
 *  revealed cards that are hand-eligible at all (a revealed card matching NO
 *  category can only be bottomed). Order follows the category list, then the
 *  order within each category, so the result is deterministic. */
export function categorizedEligibleIds(
    categories: readonly PickCategory[]
): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const category of categories) {
        for (const id of category.cardIds) {
            if (seen.has(id)) continue;
            seen.add(id);
            ids.push(id);
        }
    }
    return ids;
}

/** The MOST cards that can legally be kept from this window — the maximum
 *  matching over every eligible card. Drives the choice's `count.max` (CR
 *  608.2b: never offer a pick that cannot be made). */
export function maxCategorizedPicks(
    categories: readonly PickCategory[]
): number {
    return maximumMatching(categories, categorizedEligibleIds(categories));
}

/** Is `picks` a legal keep-set? True when the matching saturates it — every
 *  picked card can be assigned its own distinct category. A duplicate id, or a
 *  card in no category at all, is illegal. An empty pick set is always legal
 *  ("you may" keeps nothing). */
export function isCategorizedPickLegal(
    categories: readonly PickCategory[],
    picks: readonly string[]
): boolean {
    const unique = new Set(picks);
    if (unique.size !== picks.length) return false;
    return maximumMatching(categories, picks) === picks.length;
}

/** Can `cardId` be ADDED to the current `picks` and still leave a legal set?
 *  The client's per-card click gate: a second creature (with nothing else to
 *  seat it) is refused at click time rather than at submit. Re-picking an
 *  already-picked card is not an "add" — it deselects, so this returns false. */
export function canAddCategorizedPick(
    categories: readonly PickCategory[],
    picks: readonly string[],
    cardId: string
): boolean {
    if (picks.includes(cardId)) return false;
    return isCategorizedPickLegal(categories, [...picks, cardId]);
}

/** The FORCED keep-set when the categorized pick admits no real decision at
 *  all (issue #1945, CR 608.2b — a mandatory choice with no branch auto-
 *  resolves, the Arena zero-branch default): every category names AT MOST one
 *  matching id, and no id is claimed by two categories. Under those two
 *  conditions the maximum matching is unique — each nonempty category can
 *  only ever seat its own single candidate — so there is nothing for a
 *  player to decide and the pick can apply itself. Returns `undefined` the
 *  moment ANY category has 2+ candidates (a real "which one" decision) or ANY
 *  id is shared by 2+ categories (a real "which category claims it"
 *  decision, even though each side only has that one candidate) — either
 *  case must still raise the interactive picker. An all-empty category list
 *  (nothing matches anything) forces the empty set, distinct from "no forced
 *  set exists" — callers already special-case a zero matching separately
 *  (`maxCategorizedPicks(categories) === 0`) before ever reaching this. */
export function forcedCategorizedPick(
    categories: readonly PickCategory[]
): string[] | undefined {
    if (!categories.every((c) => c.cardIds.length <= 1)) return undefined;
    const picks = categories.flatMap((c) => c.cardIds);
    if (new Set(picks).size !== picks.length) return undefined;
    return picks;
}
