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
// WHAT COUNTS AS SEEN. A copy of a card is subtracted when the OBSERVER can
// point at it somewhere public. Getting the boundary wrong fails in both
// directions, and both are real bugs: subtract too little and the Brain
// imagines a fifth copy of a four-of it can see three of; subtract too much
// and it under-imagines, ruling out cards the deck could still hold.
//
// The scan is therefore by OWNERSHIP ACROSS THE WHOLE BOARD, not over the
// seat's own five piles — a card does not stop being that seat's copy because
// it is somewhere else:
//
//   * every battlefield, matched on `ownerId` — a permanent whose control
//     changed sits on the OTHER player's battlefield with `ownerId` unchanged
//     (`applyControlChange`), and the observer can plainly see it;
//   * `state.phasedOut` — phased-out permanents leave the battlefield array
//     entirely but stay face-up and public (CR 702.26);
//   * graveyards and exile, again by `ownerId`, since a card owned by this seat
//     can rest in the opponent's graveyard;
//   * that seat's own SPELLS on the stack.
//
// Hand and library are exactly the zones being sampled, so they are NOT
// subtracted here — that would be circular. The caller subtracts the
// individual hidden-zone cards the observer is separately entitled to see.
//
// Only SPELLS count on the stack (`isSpellStackItem`), and never a COPY: an
// ability's stack item carries its SOURCE card's identity while that source
// sits on the battlefield, and a copy of a spell is not a card at all
// (CR 707.10), so subtracting either removes one physical card twice.
//
// UNREADABLE IDENTITIES ARE NOT SUBTRACTED. A face-down permanent, and a card
// in a hidden zone the observer has not been shown, have no identity the
// observer may act on — ruling them out would narrow the pool using knowledge
// it does not have. `knownTo` is the engine's own record of who knows an
// instance's identity while it sits in a hidden zone (library, hand, face-down
// exile), so it is what this asks rather than a second, parallel notion.

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

/** Can `observerId` act on this instance's identity?
 *
 *  Two independent ways the answer is no, and the diff between them is why
 *  this is one predicate rather than a `faceDown` check:
 *    - `faceDown` — a face-down permanent (the battlefield case);
 *    - `knownTo` set and missing the observer — the hidden-zone case, which is
 *      how face-down EXILE is modelled (impulse draw, foretell): those cards
 *      keep their real `card.id` and are gated by `knownTo` alone, so a
 *      `faceDown` check does not see them.
 *  `knownTo` absent means the zone is public and everyone reads it. */
function readableBy(card: CardInstanceState, observerId: string): boolean {
    if (card.faceDown === true) return false;
    return card.knownTo === undefined || card.knownTo.includes(observerId);
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
    deckCardIds: readonly string[],
    observerId: string
): string[] {
    const remaining = new Map<string, number>();
    for (const id of deckCardIds) {
        remaining.set(id, (remaining.get(id) ?? 0) + 1);
    }

    /** Subtract one copy for a card this seat OWNS and the observer can read. */
    const account = (c: CardInstanceState): void => {
        if (c.ownerId !== player.id) return;
        if (!readableBy(c, observerId)) return;
        removeOne(remaining, cardIdOf(c));
    };

    // By OWNERSHIP across every battlefield, graveyard and exile — a stolen
    // permanent, or a card that died under the opponent, is still this seat's
    // copy and the observer can see it.
    for (const seat of state.players) {
        for (const c of seat.battlefield) account(c);
        for (const c of seat.graveyard) account(c);
        for (const c of seat.exile) account(c);
    }
    // Phased-out permanents are off the battlefield array but still public.
    for (const bundle of state.phasedOut ?? []) {
        for (const c of bundle.cards) account(c);
    }
    for (const item of state.stack) {
        if (item.ownerId !== player.id) continue;
        if (!isSpellStackItem(item)) continue;
        // A copy is not a card (CR 707.10) — it never left the library.
        if (item.isCopy) continue;
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
