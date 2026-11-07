/**
 * What a held storm spell is still worth (CR 702.40a, issue #8294).
 *
 * Storm copies a spell once for each spell cast before it this turn, so a storm
 * card held beside spells it can follow is worth more than its one script: each
 * of them is a copy it would gain by waiting. Priced at the script alone, firing
 * it first read as a small gain, with the copies it gave up costing nothing.
 *
 * Only the spells still to come count. The ones already cast this turn are the
 * copies the cast collects right now, and a storm count with nothing left to
 * follow it is a reason to fire, never to hold.
 *
 * PURE: reads the hand and the definition registry, mutates nothing.
 */

import type { LatentWeights } from "./evalWeights";
import type { CardInstanceState, GameState, PlayerState } from "../state";
import { isLand, manaValue } from "../constants";
import { getInstanceManaCost, tryGetDefinition } from "../../cards";
import { dslSpellScriptValue } from "./cardScriptValue";

const STORM_KEYWORD = "storm";

export function isStormCard(card: CardInstanceState): boolean {
    return card.staticAbilities.includes(STORM_KEYWORD);
}

/** Whether `card` can go on the stack in the turn being played by `state`'s
 *  active player: anything on its holder's own turn, only what has instant
 *  timing on another's (CR 117.1a). */
function castableThisTurn(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState
): boolean {
    return (
        state.activePlayerId === player.id ||
        card.types.includes("Instant") ||
        card.staticAbilities.includes("flash")
    );
}

/** The other cards in hand the player can cast ahead of `stormCard` with the
 *  mana it has now. Colour is left to the search: this counts what could
 *  follow, the line itself still has to be found. */
function castablePredecessors(
    state: GameState,
    player: PlayerState,
    stormCard: CardInstanceState,
    manaNow: number
): number {
    return player.hand.filter(
        (card) =>
            card.id !== stormCard.id &&
            !isLand(card) &&
            castableThisTurn(state, player, card) &&
            manaValue(getInstanceManaCost(card)) <= manaNow
    ).length;
}

/** Whether casting storm spell `card` now gives up copies the spells still
 *  castable ahead of it would have added (CR 702.40a). */
export function firesStormBeforeItsSpells(
    state: GameState,
    player: PlayerState,
    card: CardInstanceState,
    manaNow: number
): boolean {
    return castablePredecessors(state, player, card, manaNow) > 0;
}

/** The copies `player`'s held storm spells would gain from the spells still
 *  castable before them, on the `hand` term's own scale. Zero with no storm card
 *  in hand, which is every ordinary leaf. */
export function heldStormCopiesWorth(
    state: GameState,
    player: PlayerState,
    manaNow: number,
    latent: LatentWeights
): number {
    let total = 0;
    for (const card of player.hand) {
        if (!isStormCard(card)) continue;
        const def = tryGetDefinition(String(card.card.id ?? ""));
        const perCopy = def
            ? (dslSpellScriptValue(def, undefined, latent) ?? 0)
            : 0;
        if (perCopy <= 0) continue;
        total += perCopy * castablePredecessors(state, player, card, manaNow);
    }
    return total;
}
