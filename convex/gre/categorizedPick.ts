/** Categorized-pick legality (CR 401.4 / 701.20a) — the shared, PURE core of
 *  the `revealAndCategorize` (issue #1364) and `chooseCategorized` (issue
 *  #1945) Ops. TWO rules over the same bipartite core, deliberately split
 *  rather than merged: the INJECTIVE rule (everything down to
 *  `canAddCategorizedPick`) and the COVER rule (the `…Cover` family at the
 *  bottom, with its own section comment). Read that section before touching
 *  the shared `maximumMatching`.
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

// ---------------------------------------------------------------------------
// The COVER rule (issue #1945) — the module's SECOND legality rule.
//
// Everything above is the INJECTIVE rule: "keep at most one member per
// category, each member kept for only one category" (Atraxa's "for each card
// type, you may put A card of that type into your hand" — a card with two
// types is kept once, for one of them). Every existing consumer keeps that
// rule unchanged.
//
// `chooseCategorized` (Noxious Vapors, Planar Overlay) asks a DIFFERENT
// question: each category NOMINATES a member, and one member may answer
// SEVERAL categories at once. Gatherer, Planar Overlay: "If you have a land
// which counts as multiple land types, you can choose that land as each of
// those types. For example, a dual land could be chosen as two of your land
// types." (Noxious Vapors' multicoloured card is the same shape: the WU gold
// card may be the card chosen for BOTH white and blue.) So a player with a
// Plains and a Tundra may nominate the Tundra for Plains AND for Island and
// return only ONE land — the injective rule would force them to return two.
//
// Formally the submitted set S is legal iff some function
// `f: nonempty categories → S` exists with `f(c) ∈ c.cardIds` that is ONTO S.
// That is equivalent to the two conditions below, which is why the same
// `maximumMatching` core backs both rules:
//   (1) COVER — every non-empty category contains a member of S (otherwise
//       that category has no nomination), and
//   (2) SATURATION — the matching seats all of S in distinct categories
//       (otherwise some member of S answers no category of its own: it is a
//       gratuitous extra the player was never asked to nominate).
// (⇐/⇒: pick one witness category per member for the injective direction;
// fill the remaining categories from the cover for the surjective one.)
// ---------------------------------------------------------------------------

/** Does `picks` name a member of every NON-EMPTY category? A category with no
 *  matching member at all is simply not filled (CR 608.2b — there is nothing
 *  to nominate). */
function coversEveryCategory(
    categories: readonly PickCategory[],
    picks: ReadonlySet<string>
): boolean {
    return categories.every(
        (c) => c.cardIds.length === 0 || c.cardIds.some((id) => picks.has(id))
    );
}

/** Is `picks` a legal answer under the COVER rule — every non-empty category
 *  nominated, and no member picked that earns no category of its own? A
 *  duplicate id is illegal (one physical member is nominated once, however
 *  many categories it answers). */
export function isCategorizedCoverLegal(
    categories: readonly PickCategory[],
    picks: readonly string[]
): boolean {
    const unique = new Set(picks);
    if (unique.size !== picks.length) return false;
    if (maximumMatching(categories, picks) !== picks.length) return false;
    return coversEveryCategory(categories, unique);
}

/** The SMALLEST number of members that can cover every non-empty category —
 *  the cover rule's `count.min` (CR 608.2b: never force a pick larger than
 *  the rules require). Distinct from `maxCategorizedPicks`, which is the
 *  ceiling: with a Plains and a Plains/Island dual the minimum is 1 (the dual
 *  answers both types) while the maximum is 2. Exact minimum set cover by
 *  bitmask DP over the non-empty categories — a card definition names a
 *  handful of them (5 basic land types, 5 colours), so the 2^k table is tiny
 *  by construction, exactly like the matching above. */
export function minCategorizedCover(
    categories: readonly PickCategory[]
): number {
    const nonEmpty = categories.filter((c) => c.cardIds.length > 0);
    if (nonEmpty.length === 0) return 0;
    const full = (1 << nonEmpty.length) - 1;
    const masks = categorizedEligibleIds(nonEmpty).map((id) =>
        nonEmpty.reduce(
            (mask, c, i) => (c.cardIds.includes(id) ? mask | (1 << i) : mask),
            0
        )
    );
    const best = new Array<number>(full + 1).fill(Number.POSITIVE_INFINITY);
    best[0] = 0;
    for (let covered = 0; covered <= full; covered++) {
        if (best[covered] === Number.POSITIVE_INFINITY) continue;
        for (const mask of masks) {
            const next = covered | mask;
            if (best[covered] + 1 < best[next]) best[next] = best[covered] + 1;
        }
    }
    return best[full];
}

/** The FORCED answer when the cover admits no real decision at all (issue
 *  #1945, CR 608.2b — a mandatory choice with no branch auto-resolves, the
 *  Arena zero-branch default): every category names AT MOST one candidate, so
 *  each non-empty category's nomination is already determined. Returns
 *  `undefined` the moment ANY category has 2+ candidates — that is a real
 *  "which one" decision and must raise the interactive picker.
 *
 *  Unlike the injective rule, a candidate SHARED by two single-candidate
 *  categories is still forced here (a lone dual land must answer both its
 *  types, and only that one land is returned) — the shared id is DEDUPED
 *  rather than refused. An all-empty category list forces the empty set,
 *  distinct from "no forced set exists". */
export function forcedCategorizedCover(
    categories: readonly PickCategory[]
): string[] | undefined {
    if (!categories.every((c) => c.cardIds.length <= 1)) return undefined;
    return [...new Set(categories.flatMap((c) => c.cardIds))];
}
