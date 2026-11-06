// Whether to pay an as-enters discard (Mox Diamond's "you may discard a land
// card instead", CR 614.1a) — the one reading the live Brain submits
// (`src/lib/ai/brain.ts`) and the search plays out (`forcedChoiceAnswer`), so
// a line the search scores is the line the Bot then actually plays.
import type { GameState, PlayerState } from "../state";
import { getExtraLandDrops } from "../rules";
import { LAND_DROPS_PER_TURN } from "../constants";

/** A controller with this many or fewer lands in play is still developing its
 *  mana and is "land-light" (issue #242): lands are the constraining resource
 *  and must NOT be auto-discarded. The reported case (1 land in play) sits well
 *  inside this band, so the bot keeps the land and sheds a spell instead. Above
 *  the threshold the board is mana-developed and an excess land is a fair pitch
 *  (the land-flooded counter-case). CR 305.2 caps a player at one land drop per
 *  turn, so ~4 lands in play is enough to operate while extra lands in hand
 *  are surplus. */
export const LAND_LIGHT_LANDS_IN_PLAY = 4;

/** Whether `player` can still make a land drop this turn (CR 305.2). */
export function isLandDropOpen(
    state: Pick<GameState, "extraLandDropsThisTurn">,
    player: PlayerState
): boolean {
    return (
        (player.landsPlayedThisTurn ?? 0) <
        LAND_DROPS_PER_TURN + getExtraLandDrops(state, player)
    );
}

/** The pitch is only worth making out of SURPLUS, and for the one printed card
 *  in this family the surplus is lands (its `filter` admits nothing else).
 *  Three ways to have a spare land:
 *   - two or more lands in hand — one covers this turn's land drop, the second
 *     is surplus;
 *   - one land in hand on a mana-developed board, the land-flood case the
 *     permanent is for;
 *   - one land in hand with the drop already spent — it cannot go down this
 *     turn, and a permanent source now is at least the source it would be next
 *     turn.
 *  Otherwise the land IS the mana development, and it stays. */
export function asEntersDiscardPays(lands: {
    landsInHand: number;
    landsInPlay: number;
    landDropOpen: boolean;
}): boolean {
    if (lands.landsInHand >= 2) return true;
    if (lands.landsInHand < 1) return false;
    return lands.landsInPlay >= LAND_LIGHT_LANDS_IN_PLAY || !lands.landDropOpen;
}
