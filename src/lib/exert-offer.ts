import type { CardInstance } from "~/types/game";
import { mayExertAsAttacks } from "@convex/gre/exert";

/** CR 508.1g / 701.43d — true when at least one of the declared attackers
 *  offers the optional "exert as it attacks" cost. Read from the SAME
 *  authority the exert control and the `toggleExert` mutation use
 *  (`mayExertAsAttacks` on the projected permanent, so an attacker that lost
 *  its abilities — CR 613.1f — offers nothing here either), so the answer
 *  cannot drift from either. */
export function anyAttackerOffersExert(
    battlefield: readonly CardInstance[],
    attackerIds: readonly string[]
): boolean {
    const declared = new Set(attackerIds);
    return battlefield.some(
        (c) => declared.has(c.id) && mayExertAsAttacks(c) !== undefined
    );
}
