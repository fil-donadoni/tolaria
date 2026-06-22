import { getInstanceManaCost } from "../cards";
import type { Demand } from "./autoTap";
import { hasInstantSpeed } from "./constants";
import type { CardInstanceState } from "./state";
import { normalizeManaCost } from "./state";

/**
 * Build the **hand-spell Demands** for smart auto-tap (PRD #472, ADR 0034,
 * issue #474 — the spine).
 *
 * A Demand here is *another* spell in the paying player's hand whose mana cost
 * the solver tries not to strand when it auto-taps for the spell being cast.
 * This is the demand-aware spine: it enumerates every castable-shaped hand
 * card other than the one currently being paid for, carrying its normalized
 * mana cost. The auto-tap scorer (`scorePreservedDemands`) then measures, for
 * each candidate tap plan, how many of these stay individually affordable
 * after the payment.
 *
 * **Timing filter (issue #475, CR 307 / 601.3a / 602 / 603).** A hand spell is
 * a preservable Demand only when it is legal to *cast at the current timing*:
 *  - Instant-speed spells (Instants and Flash cards, CR 702.8) can be cast in
 *    any priority window, including the opponent's turn — they always count.
 *  - Sorcery-speed spells (creatures, sorceries, and any non-flash permanent)
 *    may be cast only when the player could cast a sorcery (CR 307.1 / 601.3a):
 *    their own main phase, empty stack, holding priority. They count only when
 *    `isSorceryTiming` is true. Off-turn / instant-window payments do NOT
 *    preserve mana for them — auto-tap must not hoard mana for plays the player
 *    cannot legally make right now (PRD #472 user stories 4 & 5).
 *
 * `isSorceryTiming` is computed by the caller via the engine's existing
 * `isSorceryTiming(state)` helper (`phases.ts`) — the timing condition is never
 * re-derived here. Instant-speed legality is the canonical `hasInstantSpeed`
 * predicate (`constants.ts`).
 *
 * Scope of this slice (deliberately narrow — siblings layer on top):
 *  - Lands are skipped (they aren't cast and have no mana cost).
 *  - Cards with no mana cost (can't strand mana) are skipped.
 *  - The card being cast (`excludeInstanceId`) is excluded — it's the payment
 *    target, not a Demand.
 *  - X in a cost is treated as 0 here (`normalizeManaCost` default). Issue
 *    #477 inflates X-spells to an assumed X=1.
 *
 * Demand affordability *before* and *after* payment is decided downstream in
 * `solveSmartAutoTap` against the real untapped sources + floating mana — this
 * helper only assembles the candidate cost list, deterministically in hand
 * order.
 */
export function buildHandSpellDemands(
    hand: CardInstanceState[],
    excludeInstanceId: string,
    isSorceryTiming: boolean
): Demand[] {
    const demands: Demand[] = [];
    for (const card of hand) {
        if (card.id === excludeInstanceId) continue;
        // Lands aren't cast (CR 305.1) — no mana cost to preserve for.
        if (card.types.includes("Land")) continue;
        // Timing filter (CR 307.1 / 601.3a): a sorcery-speed spell is a
        // preservable Demand only at sorcery timing; instant-speed spells
        // (Instant / Flash, CR 702.8) count in any priority window.
        if (!hasInstantSpeed(card) && !isSorceryTiming) continue;
        const rawCost = getInstanceManaCost(card);
        if (!rawCost) continue;
        const cost = normalizeManaCost(rawCost);
        // A free (no-mana) spell can never be stranded by auto-tap.
        if (Object.keys(cost).length === 0) continue;
        demands.push({ id: card.id, cost });
    }
    return demands;
}
