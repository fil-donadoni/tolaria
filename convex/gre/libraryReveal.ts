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

import type { GameState, PlayerState } from "./state";
import { liveStaticDefinition } from "./constants";
import { looksAtLibraryTopOf } from "../cards/abilities/classLevels";

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
 *  `size === 0`. A player whose top card changed during an open announcement
 *  window is left out (CR 401.5, {@link libraryTopFrozenOut}). A revealed player with an EMPTY library simply has no top card
 *  to expose; membership here says nothing about the library's contents. */
export function computeLibraryTopRevealedPlayers(
    state: GameState
): Set<string> {
    const revealed = new Set<string>();
    const playerList = state.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const cardList = player.battlefield;
        for (let j = 0; j < cardList.length; j++) {
            const card = cardList[j];
            // CR 613.1f — a source that lost its abilities reveals nothing.
            const scope = liveStaticDefinition(card)?.revealsLibraryTop;
            if (!scope) continue;
            if (libraryTopFrozenOut(state, player)) continue;
            // Only scope shipped today (see `CardDefinition.revealsLibraryTop`);
            // widen here in lockstep with the union when a card needs it.
            revealed.add(player.id);
        }
    }
    return revealed;
}

/** CR 401.5 / 604.2 — ids of the players who may currently LOOK at the top card
 *  of their own library ("You may look at the top card of your library any
 *  time" — Bolas's Citadel), derived live from the battlefield exactly like
 *  {@link computeLibraryTopRevealedPlayers}.
 *
 *  Same rule (CR 401.5 covers the reveal and the look in one sentence), same
 *  position-attached derivation, same CR 401.6 / 701.20d freshness for free —
 *  and one difference that makes it a SEPARATE set rather than a widened
 *  scope: this exposure is ASYMMETRIC. Only the library's own controller sees
 *  the card; the opponent must not. Callers therefore OR the two sets with a
 *  viewer gate (`gameProjections.ts`), never merge them.
 *
 *  A player in BOTH sets is simply revealed — the public reveal subsumes the
 *  private look, so the OR needs no precedence rule. */
export function computeLibraryTopLookedAtPlayers(
    state: GameState
): Set<string> {
    const looking = new Set<string>();
    const playerList = state.players;
    for (let i = 0; i < playerList.length; i++) {
        const player = playerList[i];
        const cardList = player.battlefield;
        for (let j = 0; j < cardList.length; j++) {
            const card = cardList[j];
            const def = liveStaticDefinition(card);
            const scope = def ? looksAtLibraryTopOf(def, card) : undefined;
            if (!scope) continue;
            if (libraryTopFrozenOut(state, player)) continue;
            // Only scope shipped today (see `CardDefinition.looksAtLibraryTop`);
            // widen here in lockstep with the union when a card needs it.
            looking.add(player.id);
        }
    }
    return looking;
}

// ---------------------------------------------------------------------------
// The announcement window (CR 401.5 sentences 2-3, CR 601.2i)
//
// "If the top card of the player's library changes while a spell is being
// cast, the new top card won't be revealed and can't be looked at until the
// spell becomes cast." Same for an ability being activated and a special
// action being taken. The window is DERIVED from the containers the engine
// already parks a half-announced action in — never a flag written at each
// construction site, so a new producer cannot forget to open it. What does need
// a record is the top card each library had BEFORE the window opened: by the
// time a snapshot is read, a changed top has already overwritten it. That
// record is written in one place, `syncAnnouncementWindow`, called by the sole
// writer of the persisted snapshot (`saveGameState`): every stable point a
// viewer can observe passes through it, and it alone holds the previous
// snapshot to read the pre-window tops from.
// ---------------------------------------------------------------------------

/** CR 401.5 / 601.2i / 602.2 / 116 — whether a spell is being cast, an ability
 *  activated or a special action taken: one of the announcement containers is
 *  open. A `pendingTarget` counts only for a cast or an activation (CR 601.2c /
 *  602.2b); a trigger's targets (CR 603.3d) and a retarget (CR 115.7 / 707.10c)
 *  are chosen outside any announcement. Of the special actions only the
 *  companion summon has a container; the others complete inside one call. */
export function isAnnouncementWindowOpen(state: GameState): boolean {
    if (state.pendingCast || state.pendingActivation) return true;
    if (state.pendingCompanionPay) return true;
    const kind = state.pendingTarget?.kind;
    return (
        state.pendingTarget !== undefined &&
        (kind === undefined || kind === "cast" || kind === "ability")
    );
}

/** The current top card id of every non-empty library. */
function libraryTopIds(state: GameState): string[] {
    return state.players.flatMap((p) =>
        p.library.length > 0 ? [p.library[0].id] : []
    );
}

/** CR 401.5 — `player`'s library top is hidden from every reveal and look
 *  effect: an announcement window is open and the card on top now is not the
 *  one that was on top when it opened. An unchanged top stays revealed; the
 *  new top is exposed again once the window closes (the spell becomes cast,
 *  the ability becomes activated, the special action is finished). */
export function libraryTopFrozenOut(
    state: GameState,
    player: PlayerState
): boolean {
    const frozen = state.announcementLibraryTops;
    if (frozen === undefined || !isAnnouncementWindowOpen(state)) return false;
    const top = player.library[0];
    return top !== undefined && !frozen.includes(top.id);
}

/** CR 401.5 — the one place the announcement window's record is kept: opens
 *  it with the library tops of `previous` (the last persisted snapshot, taken
 *  before the action that opened the window touched anything), carries it while
 *  the window stays open, and drops it once the window closes. `previous` is
 *  undefined for a game's first save, when no window can be open. */
export function syncAnnouncementWindow(
    state: GameState,
    previous: GameState | undefined
): void {
    if (!isAnnouncementWindowOpen(state)) {
        delete state.announcementLibraryTops;
        return;
    }
    if (state.announcementLibraryTops !== undefined) return;
    state.announcementLibraryTops = libraryTopIds(previous ?? state);
}
