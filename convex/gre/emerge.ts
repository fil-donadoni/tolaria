// Emerge (CR 702.119). "Emerge [cost]" is an alternative cost (CR 118.9) that
// sacrifices a creature — "Emerge from [quality]" a [quality] permanent, CR
// 702.119b — and whose total cost is then reduced by an amount of generic mana
// equal to the sacrificed permanent's mana value (CR 702.119a).
//
// The COST half rides the shared alternative-cost infra unchanged
// (`CardDefinition.emerge` is an `AlternativeCost` with a `mana` leg and a
// one-permanent sacrifice leg; `gre/alternativeCost.ts` offers and pays it).
// This module owns the REDUCTION half, which no other alternative cost has: a
// generic reduction whose size is read off the specific permanent chosen to pay
// the permanent leg.
//
// CR 702.119c — the victim is chosen "as you choose to pay a spell's emerge
// cost (see rule 601.2b)" and sacrificed "as you pay the total cost (see rule
// 601.2h)". So the reduction is known as soon as the victim is, which is
// always BEFORE any mana is paid: forced victims are picked at announcement
// (`autoResolveFungible`), and a real choice parks the cast on the permanent
// picker, whose completion applies the reduction (`selectSacrificeOnState`,
// `PendingCast.emergeReductionOwed`) before the pool is ever tested.
//
// CR 601.2f — the reduction is a COST REDUCTION, so it applies after every
// additional cost and increase has joined the total, and only to its generic
// part: "it can't be reduced to less than {0}", and coloured pips are never
// touched. Every caller therefore applies it to the already-modified total.
import type { AlternativeCost, CardDefinition } from "../cards/types";
import type { GameState, PlayerState } from "./state/declarations";
import { matchingPermanentsForAltCost } from "./alternativeCost";
import { permanentManaValue } from "./permanentView";
import type { SacrificeSelection } from "./sacrificeChoice";
import { isSacrificeSelectionComplete } from "./sacrificeChoice";

/** CR 702.119a — whether the chosen alternative cost IS `def`'s emerge cost.
 *  Compared by reference, the `evoke` / `dash` / `overload` precedent:
 *  `getAlternativeCost` resolves `def.emerge` for its own id. */
export function isEmergeAlternativeCost(
    def: CardDefinition | undefined,
    altCost: AlternativeCost | undefined
): boolean {
    return altCost !== undefined && def?.emerge === altCost;
}

/** CR 702.119a — the same question asked of an announcement id, for callers
 *  that carry only the id (a search Move). */
export function isEmergeAlternativeCostId(
    def: CardDefinition | undefined,
    alternativeCostId: string | undefined
): boolean {
    return (
        alternativeCostId !== undefined && def?.emerge?.id === alternativeCostId
    );
}

/** CR 702.119a/b — why `emerge` is not "pay [mana] and sacrifice ONE
 *  permanent", or `undefined` when it is. The reduction reads the mana value
 *  of the selection's single victim ({@link emergeVictimOf}), so a second
 *  victim, a return action, a missing mana leg or any further leg would price
 *  a cost the keyword never states. Enforced over the whole catalogue by
 *  `convex/gre/__tests__/emerge.test.ts`. */
export function emergeCostShapeError(
    emerge: AlternativeCost
): string | undefined {
    const leg = emerge.permanent;
    if (!leg || leg.action !== "sacrifice" || leg.count !== 1) {
        return 'needs permanent: { action: "sacrifice", count: 1, filter }';
    }
    if (emerge.mana === undefined) return "needs a mana leg";
    if (
        emerge.life !== undefined ||
        emerge.hand !== undefined ||
        emerge.graveyard !== undefined ||
        emerge.energy !== undefined ||
        emerge.condition !== undefined ||
        emerge.revealHand !== undefined
    ) {
        return "carries a leg emerge never states";
    }
    return undefined;
}

/** CR 601.2f — take `amount` off the GENERIC part of a normalized cost (the
 *  numeric `X` slot), flooring it at zero. Coloured pips are untouched: a
 *  generic reduction can never pay for one. Mutates `cost` in place, the
 *  `applyCostModifiers` convention. */
export function reduceGenericCost(
    cost: Record<string, number>,
    amount: number
): void {
    if (amount <= 0) return;
    const reduced = Math.max(0, (cost.X ?? 0) - amount);
    if (reduced > 0) cost.X = reduced;
    else delete cost.X;
}

/** CR 702.119a / 202.3 — the emerge reduction a given victim buys: its mana
 *  value as a permanent ({X} counts as 0 off the stack, a non-copy token has
 *  none). 0 when the id names no permanent on the battlefield. */
export function emergeReductionForVictim(
    state: GameState,
    victimId: string
): number {
    for (const p of state.players) {
        const victim = p.battlefield.find((c) => c.id === victimId);
        if (victim) return permanentManaValue(victim);
    }
    return 0;
}

/** CR 702.119c — the emerge victim recorded on a cast's permanent-cost
 *  selection. The emerge leg is that selection's FIRST requirement
 *  (`buildCastPermanentCostChoice` declares the alternative cost's leg before
 *  any Kicker's) and has a count of one, and picks are allocated to
 *  requirements in order, so the first pick is the victim. `undefined` while
 *  nothing is picked yet. */
export function emergeVictimOf(sel: SacrificeSelection): string | undefined {
    return sel.picked[0];
}

/** CR 702.119a / 601.2f — reduce a cast's total cost by its emerge victim's
 *  mana value. The victim must already be picked; call only once per cast. */
export function applyEmergeReduction(
    state: GameState,
    cost: Record<string, number>,
    sel: SacrificeSelection
): void {
    const victimId = emergeVictimOf(sel);
    if (victimId === undefined) return;
    reduceGenericCost(cost, emergeReductionForVictim(state, victimId));
}

/** CR 702.119c — the commit-site step: for an emerge cast, reduce `cost` now
 *  when the permanent-cost selection is already complete (a forced or
 *  fungible victim, picked at announcement), and report `true` — "reduction
 *  still owed" — when the cast must park for a real pick first, so the caller
 *  stamps `PendingCast.emergeReductionOwed`. `false` for any other cast. */
export function settleEmergeReduction(
    state: GameState,
    isEmergeCast: boolean,
    cost: Record<string, number>,
    sel: SacrificeSelection | undefined
): boolean {
    if (!isEmergeCast || !sel) return false;
    if (!isSacrificeSelectionComplete(sel)) return true;
    applyEmergeReduction(state, cost, sel);
    return false;
}

/** The permanent the emerge cost would sacrifice for the LARGEST reduction —
 *  the highest mana value among the caster's matching permanents, ties broken
 *  on instance id so the answer is deterministic. `undefined` when none
 *  matches (the cost is then not payable at all, `canPayAlternativeCost`).
 *
 *  Two readers, one answer: the castability gate (`gre/rules.ts`) asks whether
 *  SOME victim makes the cast affordable, and the reduction is monotone in the
 *  mana value, so the largest one decides it; the Bot's enumerator names this
 *  victim on its Move (`planCastCostPicks`) and prices the cast with its
 *  reduction, so the plan it taps for is the one the server charges. */
export function largestEmergeVictim(
    player: PlayerState,
    emerge: AlternativeCost
): { id: string; manaValue: number } | undefined {
    let best: { id: string; manaValue: number } | undefined;
    for (const c of matchingPermanentsForAltCost(player, emerge)) {
        const mv = permanentManaValue(c);
        if (
            !best ||
            mv > best.manaValue ||
            (mv === best.manaValue && c.id < best.id)
        ) {
            best = { id: c.id, manaValue: mv };
        }
    }
    return best;
}

/** The largest emerge reduction `player` can buy right now: the mana value of
 *  {@link largestEmergeVictim}, 0 when nothing matches. */
export function largestEmergeReduction(
    player: PlayerState,
    emerge: AlternativeCost
): number {
    return largestEmergeVictim(player, emerge)?.manaValue ?? 0;
}
