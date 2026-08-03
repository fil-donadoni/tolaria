// Continuous library-top reveal (CR 401.5) — "Play with the top card of your
// library revealed" (Goblin Spy, issue #1095 gap 7).
//
// A static ability on a battlefield permanent (CR 604.2: its continuous effect
// is active for exactly as long as the permanent is on the battlefield) makes
// the TOP card of a library — and only the top card — visible to EVERY player.
//
// Modelled as a DERIVATION, never as stored state. Two CR rules force that:
//
//   * CR 401.6 — "If an effect causes a player to play with the top card of
//     their library revealed, and that particular card stops being revealed for
//     any length of time before being revealed again, it becomes a new object."
//   * CR 701.20d — "If cards in a player's library are shuffled or otherwise
//     reordered, any revealed cards that are reordered stop being revealed and
//     become new objects."
//
// i.e. the reveal is attached to the POSITION (top of library), not to a card.
// Recomputing it from the battlefield on every read gives that for free: a
// draw, a shuffle, a mill, a put-on-top or the source leaving play all change
// what is revealed with no flag to update and none to clear. A persistent
// `CardInstanceState.knownTo` stamp would be the opposite — `clearKnowledge`
// wipes it on every shuffle, and it would need re-applying at each of the
// library write sites, which is precisely the stale-reveal bug class.
//
// CR 400.2 — a library remains a HIDDEN zone even while a card in it is
// revealed. This exposes ONE card's identity; it never opens the zone.
//
// CR 613.11 — a continuous effect that modifies the rules of the game (what
// players may see) rather than any object's characteristics, so it is
// deliberately outside the layer system (`gre/layers.ts` models
// characteristics only).

import type { GameState } from "./state";
import { tryGetDefinition } from "../cards";

/** CR 401.5 / 604.2 — ids of the players currently playing with the top card of
 *  their library revealed, derived live from the battlefield.
 *
 *  Scans every battlefield permanent for a `revealsLibraryTop` scope on its
 *  definition. `"controller"` reveals that permanent's controller's library top
 *  (permanents live in their controller's `battlefield` array, so the array
 *  owner IS the controller) — the exact shape `computeHandRevealedPlayers`
 *  (`convex/gameProjections.ts`, issue #735) uses for the hand.
 *
 *  Returns an empty set when no such permanent is on any battlefield, which is
 *  the overwhelmingly common case — callers can skip all reveal work on
 *  `size === 0`. A revealed player with an EMPTY library simply has no top card
 *  to expose; membership here says nothing about the library's contents. */
export function computeLibraryTopRevealedPlayers(
    state: GameState
): Set<string> {
    const revealed = new Set<string>();
    for (const player of state.players) {
        for (const card of player.battlefield) {
            const cardId = (card.card as { id?: string }).id;
            const scope = cardId
                ? tryGetDefinition(cardId)?.revealsLibraryTop
                : undefined;
            if (!scope) continue;
            // Only scope shipped today (see `CardDefinition.revealsLibraryTop`);
            // widen here in lockstep with the union when a card needs it.
            revealed.add(player.id);
        }
    }
    return revealed;
}
