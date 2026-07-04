// Shared, pure play-land core (CR 305 / CR 302.6).
//
// Playing a land (or any permanent via the play-land action) is the ONE board
// transition that two distinct call sites must keep byte-identical:
//   * the authoritative `playCard` mutation in `convex/game.ts`, and
//   * the Bot's 1-ply move simulator `applyMoveForSearch` in `applyMove.ts`.
//
// Before this helper the two sequences had drifted: `applyMove.ts` called
// `markEnteredThisTurn` (so a manland animated the turn it was played read
// summoning-sick), while `game.ts` did not — so in a REAL game a Mishra's
// Factory played and animated turn 1 could illegally attack. Consolidating the
// canonical sequence here makes the drift structurally impossible: both paths
// call `applyPlayLand`, so they cannot diverge again.
//
// This is a leaf primitive: it performs the zone move + bookkeeping + trigger
// scan + SBA pass, but NOT the caller's surrounding concerns (game.ts owns
// validation / seq / persistence; applyMove owns its search framing).

import type { CardInstanceState, GameState, PlayerState } from "./state";
import {
    moveCard,
    markEnteredThisTurn,
    emitPermanentEntered,
    processPendingActionTriggers,
    shouldEnterTapped,
    applyExistingGrantsTo,
    applySourceStaticEffects,
} from "./state";
import { checkStateBasedActions } from "./sba";

/**
 * Canonical play-land transition. Moves `cardInstanceId` from the player's hand
 * to the battlefield and runs the full post-entry bookkeeping. Pure: mutates
 * the passed-in `state` / `player` in place (callers clone first) and returns
 * the now-on-battlefield instance.
 *
 * Sequence (must match both call sites — that's the whole point):
 *   1. moveCard hand → battlefield
 *   2. CR 305.2 — record the land drop (only when the card is a Land; the
 *      legality check upstream already enforces the per-turn limit, this just
 *      records the spend so the next getLegalActions returns no "play").
 *   3. CR 302.6 — start the control-continuity clock on EVERY played permanent
 *      via `markEnteredThisTurn`. Inert for noncreatures, but meaningful the
 *      moment the permanent becomes a creature: a manland (Mishra's Factory)
 *      animated the same turn it was played then correctly reads summoning-sick,
 *      while one controlled continuously since a prior turn (flag cleared at the
 *      prior cleanup) does not. Untap precedes the first main phase, so the flag
 *      survives into declare-attackers on turn 1.
 *   4. CR 614.1c — a land with its own `entersTapped`/`entersTappedUnless`
 *      (Nevinyrral's-Disk-style unconditional tap, fast lands, Arena of Glory,
 *      Starting Town) or forced tapped by a battlefield-scanned opponent
 *      replacement (Kismet) enters tapped. Evaluated via the SAME
 *      `shouldEnterTapped` oracle every other ETB site (resolved spell,
 *      reanimation, token creation) uses — and, like every one of those sites,
 *      evaluated BEFORE the card joins `player.battlefield` (captured from
 *      hand pre-move), so a board-conditional predicate counting "other
 *      lands" never double-counts the entering land against itself. A land
 *      played directly can never drift from a land that enters via casting
 *      an artifact-land or similar.
 *   5. CR 611.2 — absorb existing battlefield sources' keyword-grant /
 *      type-add / subtype-add static effects (Urborg, Tomb of Yawgmoth
 *      already in play makes a freshly PLAYED land a Swamp too), then push
 *      this land's OWN static effects out to every matching permanent already
 *      on the battlefield (Urborg/Yavimaya played AFTER other lands must
 *      still turn them into Swamps/Forests). Mirrors the identical two-call
 *      sequence `finalizeSpellResolution` runs for a CAST permanent — lands
 *      never go through that path (they're played, not cast), so without this
 *      a land-shaped static effect would silently never apply.
 *   6. CR 603.6a — emit PERMANENT_ENTERED so ETB triggers (e.g. Ankh of Mishra)
 *      see the land enter, then process pending action triggers.
 *   7. CR 704 — run state-based actions to a stable point.
 */
export function applyPlayLand(
    state: GameState,
    player: PlayerState,
    cardInstanceId: string
): CardInstanceState {
    // CR 614.1c — tapped-on-entry is decided from the PRE-move board (the
    // card is still in hand here), so a board-conditional predicate counting
    // "other lands" (fast lands) doesn't double-count the entering land
    // against itself once `moveCard` below pushes it onto the battlefield.
    const handCard = player.hand.find((c) => c.id === cardInstanceId);
    const willEnterTapped = handCard
        ? shouldEnterTapped(state, handCard)
        : false;

    const card = moveCard(player, cardInstanceId, "hand", "battlefield");

    // CR 305.2 — track the land drop.
    if (card.types.includes("Land")) {
        player.landsPlayedThisTurn = (player.landsPlayedThisTurn ?? 0) + 1;
    }

    // CR 302.6 — control-continuity clock (summoning sickness for manlands).
    markEnteredThisTurn(card);

    if (willEnterTapped) card.isTapped = true;

    // CR 611.2 — two-way static-effect reconciliation (see step 5 above).
    applyExistingGrantsTo(state, card);
    applySourceStaticEffects(state, card);

    // CR 603.6a — ETB triggers see the permanent enter.
    emitPermanentEntered(state, card);
    processPendingActionTriggers(state);

    // CR 704 — settle state-based actions.
    checkStateBasedActions(state);

    return card;
}
