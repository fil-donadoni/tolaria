import { getInstanceManaCost } from "../cards";
import type { Demand } from "./autoTap";
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
 * Scope of this slice (deliberately narrow — siblings layer on top):
 *  - Lands are skipped (they aren't cast and have no mana cost).
 *  - Cards with no mana cost (can't strand mana) are skipped.
 *  - The card being cast (`excludeInstanceId`) is excluded — it's the payment
 *    target, not a Demand.
 *  - No **timing filter** yet (issue #475): every non-land hand spell counts
 *    regardless of instant/sorcery speed. #475 narrows this to timing-legal
 *    Demands.
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
    excludeInstanceId: string
): Demand[] {
    const demands: Demand[] = [];
    for (const card of hand) {
        if (card.id === excludeInstanceId) continue;
        // Lands aren't cast (CR 305.1) — no mana cost to preserve for.
        if (card.types.includes("Land")) continue;
        const rawCost = getInstanceManaCost(card);
        if (!rawCost) continue;
        const cost = normalizeManaCost(rawCost);
        // A free (no-mana) spell can never be stranded by auto-tap.
        if (Object.keys(cost).length === 0) continue;
        demands.push({ id: card.id, cost });
    }
    return demands;
}
