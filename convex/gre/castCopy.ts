// CR 707.12 — "an effect that instructs a player to cast a copy of an object ...
// follows the rules for casting spells, except that the copy is created in the
// same zone the object is in and then cast while another spell or ability is
// resolving." The object is an ordinary instance while it is being cast, so every
// question the cast asks reads it as it would any exiled card, and it becomes a
// spell copy at the cast choke point: off the stack it ceases to exist along the
// paths every spell copy already takes (CR 707.10a).

import { allocInstanceId, getPlayer } from "./lookup";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "./state/declarations";

/** Creates the copy in `ownerId`'s exile. CR 112.2a: "the owner of that copy is
 *  the player who is instructed to create it and given permission to cast it."
 *  Every array copied, never aliased to the card's own. */
export function createCardCopyInExile(
    state: GameState,
    card: CardInstanceState,
    ownerId: string
): string {
    const id = allocInstanceId(state);
    getPlayer(state, ownerId).exile.push({
        id,
        card: { id: (card.card as { id?: string }).id ?? "" },
        types: [...card.types],
        subtypes: [...card.subtypes],
        staticAbilities: [...card.staticAbilities],
        controllerId: ownerId,
        ownerId,
        zone: "exile",
        isTapped: false,
        castCopyOfCard: true,
        ...(card.imagePrintId ? { imagePrintId: card.imagePrintId } : {}),
    });
    return id;
}

/** CR 707.12 — "and then the copy becomes cast": from here on it is a spell copy.
 *  Called from `emitSpellCastEvent`, the one choke point every cast goes through. */
export function onCardCopyCast(item: StackItem): void {
    if (item.castCopyOfCard !== true) return;
    delete item.castCopyOfCard;
    item.isCopy = true;
}

/** CR 704.5e — "if a copy of a card is in any zone other than the stack or the
 *  battlefield, it ceases to exist": a copy no step cast, because its target went
 *  away or a cost could not be met. Not while a choice is parked: that is the
 *  resolution still casting it (CR 608.2g), and no player has priority. */
export function checkCardCopySBA(state: GameState): boolean {
    if ((state.pendingChoices?.length ?? 0) > 0) return false;
    let removed = false;
    for (const player of state.players) {
        if (!player.exile.some((c) => c.castCopyOfCard === true)) continue;
        player.exile = player.exile.filter((c) => c.castCopyOfCard !== true);
        removed = true;
    }
    return removed;
}
