// Per-seat deck knowledge for the searching Bot (issue #2789, PRD #2787).
//
// WHAT THIS IS. A seat's decklist, addressed by `playerId`, handed to the
// search so `determinize` can sample that seat's HIDDEN zones (hand + library)
// from the cards the decklist still admits, instead of re-dealing opaque
// placeholders. The type used to live in `src/lib/ai/state-adapter.ts`
// (issue #2788); it moved here because the engine is now the consumer and
// `convex/gre/` cannot import from `src/`. The adapter re-exports it, so every
// existing import site is unchanged.
//
// WHY A MULTISET, NOT A LIST. The question the search asks is "which card
// identities could still be in this seat's hidden zones, and how many of
// each?" — a counting question. A four-of with three copies already on the
// battlefield admits exactly one more, and the ONLY thing standing between the
// Brain and imagining a fifth copy is that this subtraction is exact. That is
// a correctness property, not a fidelity nicety: an imagined fifth copy is a
// card the opponent provably cannot hold, and the bot would play around it.
//
// WHAT COUNTS AS SEEN. Every zone the observer can read: the seat's
// battlefield, graveyard and exile, plus that seat's own SPELLS on the stack.
// Hand and library are exactly the zones being sampled, so they are NOT
// subtracted — subtracting them would be circular, and for a wire-projected
// opponent they hold placeholders with no identity to subtract anyway.
//
// Only SPELLS count on the stack (`isSpellStackItem`). An ability's stack item
// carries its SOURCE card's identity while that source sits on the battlefield:
// subtracting it would remove the same physical card twice and shrink the pool
// below what the decklist actually admits.
//
// Face-down permanents are deliberately NOT subtracted: a face-down permanent
// has no visible card identity, so the observer cannot rule that identity out
// of the hidden pool, and subtracting it would narrow the pool using knowledge
// the observer does not have.

import { isSpellStackItem } from "./constants";
import type { CardInstanceState, GameState, PlayerState } from "./state";

/** One seat's known deck content. `cardIds` are card DEFINITION ids (the
 *  maindeck as of game start); `playerId` selects the seat it belongs to. */
export type SeatDeckKnowledge = { playerId: string; cardIds: string[] };

/** Deck knowledge available to the search, addressed PER SEAT (issue #2788).
 *  Plain array of plain records — arrays/strings only — so it survives the
 *  structured-clone `postMessage` hop to the Brain worker unchanged.
 *
 *  A seat ABSENT from this array is BLIND and keeps the placeholder path. That
 *  absence is the single fail-closed discriminator the whole feature rests on:
 *  a seat is informed if and only if it has an entry here, never by an implicit
 *  "the opponent is probably known by now" invariant. */
export type DeckKnowledgeBySeat = SeatDeckKnowledge[];

/** Look up one seat's deck knowledge, if the caller supplied any for it. */
export function knowledgeFor(
    deckKnowledge: DeckKnowledgeBySeat | undefined,
    playerId: string
): string[] | undefined {
    return deckKnowledge?.find((k) => k.playerId === playerId)?.cardIds;
}

/** Decrement a card-id multiset by one; no-op if the id is absent (a token, or
 *  a card that entered from outside the deck, is not in the decklist). */
function removeOne(multiset: Map<string, number>, cardId: string): void {
    const n = multiset.get(cardId);
    if (n === undefined) return;
    if (n <= 1) multiset.delete(cardId);
    else multiset.set(cardId, n - 1);
}

/** A permanent whose face is down has no readable identity, so it cannot be
 *  subtracted from the hidden pool — see the header note. */
function isFaceDown(card: CardInstanceState): boolean {
    return card.faceDown === true;
}

/** `CardInstanceState.card` is a `Record<string, unknown>`, so its `id` needs
 *  narrowing at every read — the same `String(card.card.id ?? "")` idiom
 *  `evaluate.ts` uses. An instance with no id yields `""`, which matches no
 *  decklist entry and is therefore subtracted from nothing. */
function cardIdOf(card: CardInstanceState): string {
    return String(card.card.id ?? "");
}

/**
 * The card ids `player`'s hidden zones may still contain: the decklist multiset
 * minus every copy the observer can already account for in a PUBLIC zone.
 *
 * Returned as a flat, DETERMINISTICALLY ORDERED id list (decklist order, each
 * id repeated by its surviving count) — the caller shuffles it with the search
 * rng, so ordering here must not depend on iteration-order accidents.
 *
 * Never returns more ids than the decklist held, and may return FEWER than the
 * hidden zones need: deck accounting drifts (a card that left the game, a
 * sideboard swap, a token). The caller pads to the exact zone counts, so the
 * deck-out state-based action (CR 704.5b) keeps counting the right number of
 * cards whatever this returns.
 */
export function unseenRemainder(
    state: GameState,
    player: PlayerState,
    deckCardIds: readonly string[]
): string[] {
    const remaining = new Map<string, number>();
    for (const id of deckCardIds) {
        remaining.set(id, (remaining.get(id) ?? 0) + 1);
    }

    for (const c of player.battlefield) {
        if (!isFaceDown(c)) removeOne(remaining, cardIdOf(c));
    }
    for (const c of player.graveyard) removeOne(remaining, cardIdOf(c));
    for (const c of player.exile) {
        if (!isFaceDown(c)) removeOne(remaining, cardIdOf(c));
    }
    for (const item of state.stack) {
        if (item.ownerId !== player.id) continue;
        if (!isSpellStackItem(item)) continue;
        removeOne(remaining, cardIdOf(item));
    }

    // Re-walk the decklist rather than the Map so the output order is the
    // decklist's, not the Map's insertion order — same input, same list, on
    // every engine and every run.
    const seen = new Map<string, number>();
    const out: string[] = [];
    for (const id of deckCardIds) {
        const budget = remaining.get(id) ?? 0;
        const taken = seen.get(id) ?? 0;
        if (taken >= budget) continue;
        seen.set(id, taken + 1);
        out.push(id);
    }
    return out;
}
