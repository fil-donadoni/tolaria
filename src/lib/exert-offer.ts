import type { CardInstance } from "~/types/game";
import { mayExertAsAttacksById } from "@convex/gre/exert";
import { displayCardId } from "~/lib/card-utils";

/** CR 508.1g / 701.43d — true when at least one of the declared attackers
 *  offers the optional "exert as it attacks" cost. Read from the SAME
 *  definition authority the exert control and the `toggleExert` mutation use
 *  (`mayExertAsAttacksById`), so the answer cannot drift from either. */
export function anyAttackerOffersExert(
    battlefield: readonly CardInstance[],
    attackerIds: readonly string[]
): boolean {
    const declared = new Set(attackerIds);
    return battlefield.some(
        (c) =>
            declared.has(c.id) &&
            mayExertAsAttacksById(displayCardId(c)) !== undefined
    );
}
