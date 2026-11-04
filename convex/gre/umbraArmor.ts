// Umbra armor (CR 702.89a): "If enchanted permanent would be destroyed, instead
// remove all damage marked on it and destroy this Aura." The replacement itself
// is applied by `regenerateOrDestroy` (state.ts); this module holds the two
// readers it needs, free of any engine import.
//
// Read off the Aura's live `staticAbilities`, so a layer-6 grant or removal of
// the keyword is honoured.

import type { CardInstanceState, GameState } from "./state";

/** The keyword as a card's `staticAbilities` carries it (CR 702.89). */
export const UMBRA_ARMOR_KEYWORD = "umbra armor";

/** An Aura with umbra armor enchanting `enchantedId`, on any player's
 *  battlefield: an Aura's controller need not control the permanent it enchants
 *  (CR 303.4e). With several, one is picked deterministically in player and
 *  then battlefield order: CR 616.1's choice for the affected permanent's
 *  controller is not yet modelled for destroy replacements (tracked-by: #3353). */
export function findUmbraArmorAura(
    state: GameState,
    enchantedId: string
): CardInstanceState | undefined {
    for (const player of state.players) {
        const aura = player.battlefield.find(
            (card) =>
                card.attachedTo === enchantedId &&
                card.staticAbilities.includes(UMBRA_ARMOR_KEYWORD)
        );
        if (aura) return aura;
    }
    return undefined;
}

/** Orders a simultaneous destruction's victims so an attached permanent comes
 *  after every unattached one. The engine destroys one id at a time, but the
 *  event is one: an Aura destroyed by the same effect as its host still saves it
 *  (CR 702.89a), which a sequential walk reproduces only by reaching the host
 *  while the Aura is still attached. Stable within each group. */
export function attachmentsLast(
    ids: readonly string[],
    hostOf: (id: string) => string | undefined
): string[] {
    const unattached = ids.filter((id) => hostOf(id) === undefined);
    const attached = ids.filter((id) => hostOf(id) !== undefined);
    return [...unattached, ...attached];
}
