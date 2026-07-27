// Determinization for the vs-AI Bot's ISMCTS search (ADR 0001, issue #112).
//
// Information-set Monte Carlo Tree Search reasons over the bot's OBSERVED
// state, where the opponent's hand + both players' library orders are hidden.
// `determinize(state, observerId, rng)` samples ONE plausible concrete world
// consistent with everything the observer knows: it re-deals the hidden cards
// uniformly at random into the hidden zones, while leaving every PUBLIC fact
// untouched. ISMCTS re-determinizes once per iteration so the tree is not
// overfit to a single guessed world (CR has no bearing here — this is a search
// device, never an authoritative state).
//
// What is hidden vs known, from `observerId`'s point of view:
//   * Observer's OWN hand     → known (kept exactly).
//   * Observer's OWN library  → contents may be known but ORDER is not; shuffle.
//   * Opponent's hand         → hidden; its cards are indistinguishable from the
//                               opponent's library, so the two zones are pooled
//                               and re-dealt (a card the observer can't see could
//                               equally be in either zone).
//   * Opponent's library      → hidden; pooled with the opponent's hand.
//
// Public zones (battlefields, graveyards, exile, the stack, life totals, combat)
// are never touched. Zone COUNTS are always preserved: the opponent ends with
// the same hand size and library size, the observer with the same library size.
//
// PURE: clones via `cloneGameState`, draws only from the injected `rng`, never
// mutates the input. Given the same `rng` sequence it returns the same world.
//
// NOTE on the production projection: the bot consults its OWN wire viewpoint.
//   * The OBSERVER's library — since issue #1509 the state adapter rebuilds it
//     from the bot's real decklist (own-deck content is public to its owner),
//     so `determinizeObserver`'s shuffle does real work here: it hides the
//     ORDER the bot must not know while keeping the content the bot legitimately
//     does, re-sampling a plausible draw/fetch order every ISMCTS iteration.
//   * The OPPONENT's hidden zones still arrive as counts with no identities (the
//     adapter fills them with opaque placeholders, not real cards), so pooling
//     and re-dealing them is a faithful no-op — the bot searches without
//     inventing specific opponent cards.
// Fed a full-information state (as the unit tests do), it re-deals for real.

import type { CardInstanceState, GameState, PlayerState } from "./state";
import { cloneGameState } from "./clone";
import { shuffleWithRng } from "./rng";

/** Re-tag an instance's zone so the world stays internally consistent after a
 *  card is dealt into a different hidden zone. */
function inZone(
    card: CardInstanceState,
    zone: CardInstanceState["zone"]
): CardInstanceState {
    card.zone = zone;
    return card;
}

/** Sample one plausible world consistent with `observerId`'s observations.
 *  Public state is identical to the input; hidden zones are re-dealt uniformly
 *  at random while preserving every zone's card count. Pure. */
export function determinize(
    state: GameState,
    observerId: string,
    rng: () => number
): GameState {
    const next = cloneGameState(state);

    for (const player of next.players) {
        if (player.id === observerId) {
            // Own hand is known; only the library ORDER is hidden.
            determinizeObserver(player, rng);
        } else {
            // Opponent hand + library are both hidden and interchangeable.
            determinizeOpponent(player, rng);
        }
    }

    return next;
}

/** The observer keeps its hand; its library keeps its size but is reshuffled
 *  (draw order is unknown to the observer). */
function determinizeObserver(player: PlayerState, rng: () => number): void {
    player.library = shuffleWithRng(player.library, rng);
}

/** Pool the opponent's hand + library — indistinguishable to the observer —
 *  shuffle, then re-deal the first `handSize` cards back to the hand and the
 *  remainder to the library, preserving both counts. */
function determinizeOpponent(player: PlayerState, rng: () => number): void {
    const handSize = player.hand.length;
    const pool = shuffleWithRng([...player.hand, ...player.library], rng);
    player.hand = pool.slice(0, handSize).map((c) => inZone(c, "hand"));
    player.library = pool.slice(handSize).map((c) => inZone(c, "library"));
}
