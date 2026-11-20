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

import type { CardInstanceState, GameState, PlayerState } from "./state";

/** Every card `player` owns outside the game, in a stable order: the holder
 *  first, then the companion while its slot is unspent. A spent slot keeps
 *  its instance as a record (`summonCompanion`), so it is NOT outside the game
 *  any more and is excluded. */
export function outsideGamePool(player: PlayerState): CardInstanceState[] {
    const pool = (player.outsideGame ?? []).slice();
    if (player.companion && !player.companion.used) {
        pool.push(player.companion.instance);
    }
    return pool;
}

/** CR 400.11b — lifts the outside-the-game card `instanceId` out of
 *  `player`'s pool and returns it, or `undefined` when no such card is in the
 *  pool (CR 609.3 — it is gone, the move does nothing). The caller puts it
 *  wherever the effect or play sends it. Taking the companion spends its slot
 *  (`used = true`) the way `summonCompanion` does, so the summon is never
 *  offered for a card already brought in. */
export function takeFromOutsideGame(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const holder = player.outsideGame ?? [];
    const idx = holder.findIndex((c) => c.id === instanceId);
    if (idx >= 0) {
        const card = holder[idx]!;
        const rest = holder.filter((_, i) => i !== idx);
        if (rest.length > 0) player.outsideGame = rest;
        else delete player.outsideGame;
        return card;
    }
    if (
        player.companion &&
        !player.companion.used &&
        player.companion.instance.id === instanceId
    ) {
        player.companion.used = true;
        return player.companion.instance;
    }
    return undefined;
}

/** CR 400.11b — "Some effects bring cards into a game from outside the game."
 *  Moves the outside-the-game card `instanceId` into `player`'s hand and
 *  returns it, or `undefined` when no such card is in `player`'s pool
 *  ({@link takeFromOutsideGame}). */
export function bringIntoHandFromOutsideGame(
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    const card = takeFromOutsideGame(player, instanceId);
    if (!card) return undefined;
    const inHand: CardInstanceState = { ...card, zone: "hand" };
    player.hand.push(inHand);
    return inHand;
}

/** CR 400.11b / 514.2 — how many cards `playerId` may still play from outside
 *  the game this turn (`GameState.outsideGamePlaysThisTurn`). The single gate
 *  every cast and land-play site reads: `getLegalActions`, the cast-source
 *  locator, the land-play source resolver and the Bot's move enumeration. */
export function outsideGamePlaysRemaining(
    state: Pick<GameState, "outsideGamePlaysThisTurn">,
    playerId: string
): number {
    return state.outsideGamePlaysThisTurn?.[playerId] ?? 0;
}

/** The outside-the-game card `instanceId` when `player` may play it right now
 *  under an outside-game play permission — it is in their pool
 *  ({@link outsideGamePool}) and a play remains — else `undefined`. Says
 *  nothing about timing or cost: those are the cast / land-play gates' own. */
export function findOutsideGamePlayable(
    state: Pick<GameState, "outsideGamePlaysThisTurn">,
    player: PlayerState,
    instanceId: string
): CardInstanceState | undefined {
    if (outsideGamePlaysRemaining(state, player.id) <= 0) return undefined;
    return outsideGamePool(player).find((c) => c.id === instanceId);
}

/** CR 400.11b — grants `playerId` `count` more plays from outside the game
 *  this turn. Additive (two grants are two plays); cleared at CLEANUP (CR
 *  514.2). */
export function grantOutsideGamePlays(
    state: GameState,
    playerId: string,
    count: number
): void {
    if (count <= 0) return;
    state.outsideGamePlaysThisTurn = {
        ...state.outsideGamePlaysThisTurn,
        [playerId]: outsideGamePlaysRemaining(state, playerId) + count,
    };
}

/** Spends one of `playerId`'s outside-game plays — the permission is
 *  "consumed by the one play it licenses". Called at the cast commit and at
 *  the land play, never at announcement. */
export function spendOutsideGamePlay(state: GameState, playerId: string): void {
    const left = outsideGamePlaysRemaining(state, playerId) - 1;
    const rest = { ...state.outsideGamePlaysThisTurn };
    if (left > 0) rest[playerId] = left;
    else delete rest[playerId];
    if (Object.keys(rest).length > 0) state.outsideGamePlaysThisTurn = rest;
    else delete state.outsideGamePlaysThisTurn;
}
