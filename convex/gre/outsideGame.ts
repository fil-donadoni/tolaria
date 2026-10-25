// Outside the game (CR 400.11) — the per-player pool of cards a player owns
// that are in none of the game's zones, and the one move that brings such a
// card in (the Wish cards' "reveal a … card you own from outside the game and
// put it into your hand").
//
// CR 400.11: "An object is outside the game if it isn't in any of the game's
// zones. Outside the game is not a zone." The pool therefore never joins a zone
// enumerator; its two members are the `PlayerState.outsideGame` holder (the
// sideboard snapshot, CR 400.11a) and the UNUSED companion slot (ADR 0064 — a
// declared companion is a sideboard card too, so a wish whose filter admits it
// may fetch it; doing so spends the slot exactly as the summon special action
// does).

import type { CardInstanceState, PlayerState } from "./state";

/** Every card `player` owns outside the game, in a stable order: the holder
 *  first, then the companion while its slot is unspent. A spent slot keeps
 *  its instance as a record (`summonCompanion`), so it is NOT outside the game
 *  any more and is excluded. */
export function outsideGamePool(player: PlayerState): CardInstanceState[] {
    const pool = [...(player.outsideGame ?? [])];
    if (player.companion && !player.companion.used) {
        pool.push(player.companion.instance);
    }
    return pool;
}

/** CR 400.11b — "Some effects bring cards into a game from outside the game."
 *  Moves the outside-the-game card `instanceId` into `player`'s hand and
 *  returns it, or `undefined` when no such card is in `player`'s pool (CR
 *  609.3 — it is gone, the move does nothing). Taking the companion spends
 *  its slot (`used = true`) the way `summonCompanion` does, so the summon is
 *  never offered for a card already brought in. */
export function bringIntoHandFromOutsideGame(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const holder = player.outsideGame ?? [];
    const idx = holder.findIndex((c) => c.id === instanceId);
    let card: CardInstanceState;
    if (idx >= 0) {
        card = holder[idx]!;
        const rest = holder.filter((_, i) => i !== idx);
        if (rest.length > 0) player.outsideGame = rest;
        else delete player.outsideGame;
    } else if (
        player.companion &&
        !player.companion.used &&
        player.companion.instance.id === instanceId
    ) {
        card = player.companion.instance;
        player.companion.used = true;
    } else {
        return undefined;
    }
    const inHand: CardInstanceState = { ...card, zone: "hand" };
    player.hand.push(inHand);
    return inHand;
}
