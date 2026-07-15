// Madness (CR 702.35) — a keyword-cast capability that lets a card be cast for
// an alternative "madness cost" out of exile in the window immediately after it
// is discarded, or else be put into its owner's graveyard.
//
// 702.35a "Madness [cost]" represents two abilities: a replacement effect and a
//         triggered ability.
// 702.35c The replacement: "If a player would discard a card with madness, that
//         player discards it, but exiles it instead of putting it into their
//         graveyard."
// 702.35d The triggered ability: "When a card with madness is discarded and
//         exiled this way, its owner may cast it by paying its madness cost
//         rather than putting it into their graveyard. ... If the player doesn't
//         cast the card this way, they put it into their graveyard."
//
// Like Flashback (`convex/gre/flashback.ts`) and Escape, Madness is engine /
// cost-system infrastructure, NOT an Effect Script Op — a card's on-resolution
// effect stays DSL/`resolve()`; only the discard→exile replacement and the
// alternative CAST cost live here. The printed madness cost is
// `CardDefinition.madness`; the exiled instance is tagged `madnessExiled` (which
// distinguishes it from an Ice-Cauldron-style exile cast that pays the normal
// cost) and carries the shared `castableFromExileBy` cast permission.
//
// CR-simplification (documented): the reflexive "may cast" of 702.35d is not put
// on the stack as its own triggered ability. Instead the discarded card is
// exiled with a THIS-TURN cast-from-exile window (the same impulse machinery as
// Expressive Iteration), so its owner may cast it for the madness cost — at
// instant speed — any time they hold priority this turn. Any copy still in exile
// at the cleanup step is put into its owner's graveyard (`sweepUncastMadness`),
// realizing 702.35d's "if the player doesn't, they put it into their graveyard."
// The player-visible deviation is only the timing of that decision (widened from
// "immediately, as the trigger resolves" to "any time this turn"); the golden
// path (cast for the madness cost) and the decline path (to the graveyard) are
// both faithful.
import type { ManaCost } from "../cards/types";
import { tryGetDefinition } from "../cards";
import type { CardInstanceState, GameState, PlayerState } from "./state";
import { getPlayer, moveCard } from "./state";

/** The printed madness cost for `card` (CR 702.35a), or `undefined` when the
 *  card has no madness. `Madness {0}` is a real, present cost of `{}` (empty) —
 *  distinct from `undefined` (no madness at all). */
export function getMadnessCost(card: CardInstanceState): ManaCost | undefined {
    const id = (card.card as { id?: string }).id;
    if (!id) return undefined;
    return tryGetDefinition(id)?.madness;
}

/** Whether `card` has a madness cost of any shape (including `Madness {0}`). */
export function hasMadness(card: CardInstanceState): boolean {
    return getMadnessCost(card) !== undefined;
}

/** CR 702.35c — mark a card that just moved hand → exile as discarded via
 *  madness: its owner may cast it for the madness cost while it stays exiled,
 *  and (with the this-turn window) it is swept to the graveyard at cleanup if
 *  uncast. Called by `discardToGraveyard` after it redirects the discard's
 *  destination to exile. `ownerId` is the card's owner (CR 702.35d — "its owner
 *  may cast it"). */
export function markMadnessExiled(
    card: CardInstanceState,
    ownerId: string,
    turn: number
): void {
    card.madnessExiled = true;
    card.castableFromExileBy = ownerId;
    // CR 514.2 — the impulse window expires at this turn's cleanup step, where
    // `sweepUncastMadness` puts any uncast copy into its owner's graveyard.
    card.castableFromExileUntilTurn = turn;
}

/** True iff `card` is an exiled, still-uncast madness card owned+castable by the
 *  given player (CR 702.35d). Drives the "cast" legal action for the exile. */
export function isMadnessCastable(
    card: CardInstanceState,
    playerId: string
): boolean {
    return (
        card.madnessExiled === true && card.castableFromExileBy === playerId
    );
}

/** CR 702.35d — at the cleanup step, put every madness card still in exile (its
 *  owner declined to cast it during the this-turn window) into its owner's
 *  graveyard, clearing the madness/cast markers. Runs alongside the impulse
 *  cast-window revocation in `endStepAndCleanup` (`phases.ts`). */
export function sweepUncastMadness(state: GameState): void {
    for (const p of state.players) {
        const toGraveyard = p.exile.filter((c) => c.madnessExiled === true);
        for (const card of toGraveyard) {
            clearMadnessMarkers(card);
            moveCard(getPlayer(state, p.id), card.id, "exile", "graveyard");
        }
    }
}

/** Clears the madness + cast-from-exile markers off `card` (on cast to the
 *  stack, or when swept to the graveyard). */
export function clearMadnessMarkers(card: CardInstanceState): void {
    delete card.madnessExiled;
    delete card.castableFromExileBy;
    delete card.castableFromExileUntilTurn;
}

// Re-exported for callers that only need the player type in a madness context.
export type { PlayerState };
