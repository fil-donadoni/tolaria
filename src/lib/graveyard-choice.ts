import type { PendingChoice } from "~/types/game";

/** Whether a mid-resolution `choose-graveyard-card` choice (CR 608.2) is
 *  active for `viewer` and picks from `player`'s graveyard. Mirrors
 *  {@link isSelectableHandChoiceCard} at the pile level: the graveyard is a
 *  public zone, so eligibility per card is the choice's `candidateIds`
 *  allow-list, checked at click time. Used by `PlayerGraveyard` to switch the
 *  pile from `selectTarget` routing to buffered-choice routing. Recall is the
 *  first card to use it ("return a card from your graveyard … for each card
 *  discarded"). */
export function isGraveyardChoiceActive(
    choice: PendingChoice | undefined,
    player: { id: string },
    viewerId: string
): boolean {
    if (!choice) return false;
    if (choice.kind !== "choose-graveyard-card") return false;
    if (choice.playerId !== viewerId) return false;
    if (choice.zone !== "graveyard") return false;
    // The chooser picks from their OWN graveyard (zoneOwnerId defaults to the
    // chooser). Only that pile becomes selectable.
    const zoneOwner = choice.zoneOwnerId ?? choice.playerId;
    return player.id === zoneOwner;
}
