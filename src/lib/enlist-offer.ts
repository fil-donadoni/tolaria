import {
    enlistCandidates,
    enlistInstanceCount,
} from "@convex/cards/abilities/enlist";
import type { CardInstance } from "~/types/game";

export interface EnlistOffer {
    attacker: CardInstance;
    partners: CardInstance[];
}

/** CR 508.1g / 702.154a — each declared attacker with enlist, with the creatures
 *  it could tap. Reads the SAME rules the `toggleEnlist` mutation refuses on
 *  (`cards/abilities/enlist.ts`), off the projected battlefield. An attacker with
 *  no one to tap offers nothing, so it is left out. */
export function enlistOffers(
    battlefield: readonly CardInstance[],
    attackerIds: readonly string[]
): EnlistOffer[] {
    const partners = enlistCandidates(battlefield, attackerIds);
    if (partners.length === 0) return [];
    return battlefield
        .filter(
            (c) =>
                attackerIds.includes(c.id) &&
                enlistInstanceCount(c.staticAbilities) > 0
        )
        .map((attacker) => ({ attacker, partners }));
}

/** True when the declaration holds an enlist choice to make, so a one-click
 *  attack must leave the confirmation to the player. */
export function anyAttackerOffersEnlist(
    battlefield: readonly CardInstance[],
    attackerIds: readonly string[]
): boolean {
    return enlistOffers(battlefield, attackerIds).length > 0;
}
