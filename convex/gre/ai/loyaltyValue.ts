/**
 * Loyalty as a resource in the leaf evaluation (issue #2491, ADR 0107).
 *
 * THE PROBLEM. `evaluate`'s non-creature branch pays a planeswalker the flat
 * board-presence bonus plus its latent `cardValue`, and nothing else. Loyalty
 * counters carried no weight at all, so a `+1` gained nothing beyond its own
 * effect and a `-6` cost the bot NOTHING unless it landed exactly on 0 and the
 * CR 704.5i state-based action swept the walker. With the move enumerator now
 * offering loyalty abilities (the other half of #2491), the search would have
 * picked between a `+1` and a `-3` on rollout noise.
 *
 * THE MODEL — a RATIO of the walker's own worth, never an additive constant:
 *
 *     ratio    = min(currentLoyalty, ceiling) / startingLoyalty
 *     ceiling  = max(startingLoyalty, maxSpend) + 1
 *     maxSpend = the largest magnitude among the walker's NEGATIVE loyalty costs
 *
 * Four properties make it closed and future-proof:
 *
 *   1. **Nothing is invented.** Both inputs — the definition's printed starting
 *      loyalty (CR 306.5b) and the abilities' signed costs (CR 606.4) — are
 *      already on the card definition. There is no tunable constant to drift.
 *   2. **No baseline shift.** `ceiling > startingLoyalty` always, so at
 *      starting loyalty the ratio is exactly 1 and every walker scores
 *      precisely what it scored before this term existed. Existing blade
 *      entries, eval tests and ladder baselines keep their numbers.
 *   3. **The ceiling means "counters this card can still SPEND".** One past the
 *      biggest printed spend is the last counter that changes what the walker
 *      can do next turn — the buffer that eats a point of damage and still
 *      fires the ultimate. Beyond it the counters are dead weight and must not
 *      keep paying.
 *   4. **A VARIABLE (`-X`) loyalty cost never clamps.** CR 606.6 bounds X at
 *      the permanent's current loyalty, so such a walker can spend EVERY
 *      counter and none is ever dead weight — the ceiling is unbounded. Not
 *      reachable today (`cost.loyalty` is a plain number), which is exactly why
 *      the rule is written now: the ~23 cards of that class must land correctly
 *      when the type supports them, not re-open this decision.
 *
 * Death at 0 falls out arithmetically — ratio 0, then CR 704.5i removes the
 * permanent. No special case.
 *
 * The flat board-presence bonus (`W_PERMANENT`) stays UNSCALED: it prices
 * "there is a permanent here", which is true of a walker on 1 loyalty as much
 * as of one on 6.
 *
 * PURE: reads the definition registry and the instance, mutates nothing.
 */

import type { CardInstanceState } from "../state";
import { currentLoyalty } from "../loyalty";
import { isPlaneswalker } from "../constants";
import { tryGetDefinition } from "../../cards";

/**
 * The largest number of loyalty counters this definition's abilities can spend
 * in one activation (CR 606.4) — `maxSpend` above.
 *
 * `Infinity` when any negative loyalty cost is VARIABLE rather than a fixed
 * number. `cost.loyalty` is typed as a plain `number` today, so that branch is
 * unreachable from the shipped catalogue; it is written structurally (anything
 * that is not a finite number) so that widening the type to admit `-X` gives
 * the right answer without touching this file.
 */
export function maxLoyaltySpend(def: {
    activatedAbilities?: readonly { cost: { loyalty?: number } }[];
}): number {
    let maxSpend = 0;
    for (const ability of def.activatedAbilities ?? []) {
        const loyalty = ability.cost.loyalty;
        if (loyalty === undefined) continue;
        if (typeof loyalty !== "number" || !Number.isFinite(loyalty)) {
            // CR 606.6 bounds X at current loyalty — every counter is
            // spendable, so no counter is ever dead weight.
            return Infinity;
        }
        if (loyalty < 0) maxSpend = Math.max(maxSpend, -loyalty);
    }
    return maxSpend;
}

/**
 * The last loyalty counter that still changes what the walker can DO —
 * `max(startingLoyalty, maxSpend) + 1`. Counters above it are dead weight and
 * stop earning value.
 *
 * The `+ 1` is the reason no walker has a `+1` tick worth exactly zero: from
 * ANY loyalty at or below the starting count, one more counter is still under
 * the ceiling.
 */
export function loyaltySpendCeiling(def: {
    loyalty?: number;
    activatedAbilities?: readonly { cost: { loyalty?: number } }[];
}): number {
    const start = def.loyalty ?? 0;
    return Math.max(start, maxLoyaltySpend(def)) + 1;
}

/**
 * `min(loyalty, ceiling) / startingLoyalty` for a definition that HAS a printed
 * starting loyalty. `1` when it does not (no denominator), so a permanent that
 * merely became a planeswalker through a layer-4 type addition stays unscaled.
 *
 * Split out from {@link loyaltyRealizationRatio} so the rule can be exercised
 * against a CONSTRUCTED definition — notably one carrying a variable (`-X`)
 * loyalty cost, which no shipped card can express while `cost.loyalty` is typed
 * as a plain number.
 */
export function loyaltyRatioFor(
    loyalty: number,
    def: {
        loyalty?: number;
        activatedAbilities?: readonly { cost: { loyalty?: number } }[];
    }
): number {
    const start = def.loyalty;
    if (start === undefined || start <= 0) return 1;
    return Math.min(loyalty, loyaltySpendCeiling(def)) / start;
}

/**
 * The multiplier `evaluate` applies to a permanent's realized `cardValue`.
 *
 * `1` for everything that is not a planeswalker with a printed starting
 * loyalty — so the term is inert for the whole rest of the catalogue and every
 * caller may apply it unconditionally.
 *
 * Reads the definition by ID, not off the fat `card.card` object, so the value
 * is identical either side of the wire projection (`projectPublicState` strips
 * `card.card` to `{ id }` and preserves `counters`).
 */
export function loyaltyRealizationRatio(card: CardInstanceState): number {
    if (!isPlaneswalker(card)) return 1;
    const def = tryGetDefinition(String((card.card as { id?: string })?.id));
    if (!def) return 1;
    return loyaltyRatioFor(currentLoyalty(card), def);
}
