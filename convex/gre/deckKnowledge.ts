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

import type { Color } from "../cards/types";
import { getCardColors } from "../cards/colors";
import { tryGetDefinition } from "../cards";
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

// ---------------------------------------------------------------------------
// The decklist as COLOUR evidence (issue #3533, PRD #3526)
// ---------------------------------------------------------------------------
//
// WHY THIS LIVES HERE. `observedColors.ts` owns the opponent's colour-demand
// estimate and is the single home for it (issue #2306, issue #3532). What it
// could not see is the one thing an `expert` search is legitimately handed:
// the seat's real decklist. A deck that is 40% green says more about what
// denying green costs than two Forests on the battlefield do — but that has to
// SHARPEN the existing evidence hierarchy, never bypass it, so the decklist is
// lowered HERE into the same per-colour mass the other evidence classes speak,
// and folded in there.
//
// ONE UNIT PER COLOURED CARD, which is the same unit every other class uses,
// and deliberately the WEAKEST one (`POTENTIAL_MANA_WEIGHT`, 1): a card in the
// decklist is the most purely potential evidence there is — it may never be
// drawn. There are simply a lot of them, which is exactly why a deck's colour
// identity outweighs two lands without any special pleading.
//
// NOT normalised to a share, and not netted against what is already on the
// board. Both were considered:
//
//   - a normalised share would make the decklist a fixed mass whatever the
//     deck size, i.e. a second, differently-scaled unit beside the board's —
//     the drift this module exists to avoid;
//   - netting against `unseenRemainder` would stop a green creature counting
//     twice (battlefield 3 + decklist 1). It is rejected because the remainder
//     is a ROOT quantity: it is exact where it is computed and goes stale at
//     every node below, whereas the decklist's colour identity is constant over
//     the whole search. A constant that is slightly generous beats a variable
//     that is silently wrong, and the double count is 1 against 3.
//
// COLOURLESS IS NOT A COLOUR (CR 105.2a) and lands have no mana cost, so a
// manabase contributes nothing here — the colour evidence a land carries is
// already priced, on the board, by `untappedProducibleColors`.

/** Per-colour evidence mass contributed by one seat's decklist, in the SAME
 *  unit as `ObservedColorEvidence` (`gre/ai/observedColors.ts`): one point per
 *  coloured card, counted once per colour the card actually is (a gold card
 *  counts for each of its colours — it demands each of them). */
export type DeckColorEvidence = Partial<Record<Exclude<Color, "C">, number>>;

/** One seat's decklist colour evidence, addressed exactly like
 *  {@link SeatDeckKnowledge}. */
export type SeatDeckColors = { playerId: string; colors: DeckColorEvidence };

/** Decklist colour evidence the SEARCHER is entitled to, per seat — the
 *  lowered form of {@link DeckKnowledgeBySeat} that rides on `GameState` so
 *  every leaf evaluation of a determinized tree reads the same one
 *  (`gre/state.ts`, `gre/determinize.ts`).
 *
 *  Plain array of plain records, arrays/strings/numbers only, for the same
 *  reason `DeckKnowledgeBySeat` is: it survives the structured-clone hop to
 *  the Brain worker and the search's own `cloneGameState` unchanged. It is
 *  also SMALL by construction — at most five numbers per seat — which is why
 *  the lowered form rides along instead of the decklist itself, cloned once
 *  per search node. */
export type DeckColorsBySeat = SeatDeckColors[];

/** Lower a decklist into {@link DeckColorEvidence}. A card id with no
 *  resolvable definition contributes nothing — same posture as
 *  `cardStaticColors` in `observedColors.ts`, and the same reason: an identity
 *  the registry cannot resolve is not evidence of anything. */
export function deckColorEvidence(
    deckCardIds: readonly string[]
): DeckColorEvidence {
    const out: Record<string, number> = {};
    for (const id of deckCardIds) {
        const def = tryGetDefinition(id);
        if (!def) continue;
        for (const color of getCardColors(def)) {
            // Type narrowing, not a behaviour guard: `getCardColors` reads the
            // mana cost through `getColorsFromCost`, which already skips "C"
            // (CR 105.2a — colourless is not a colour). The branch exists
            // because its return type is the full `Color` union.
            if (color === "C") continue;
            out[color] = (out[color] ?? 0) + 1;
        }
    }
    return out as DeckColorEvidence;
}

/** Every seat OTHER than `observerId` whose decklist the search was granted,
 *  lowered into {@link DeckColorEvidence} — the whole of `GameState`'s
 *  `deckColorKnowledge`, built ONCE per search (issue #3533).
 *
 *  THE OBSERVER IS EXCLUDED, and that exclusion is the gate, not a tidiness.
 *  The client hands the Bot its OWN decklist at every difficulty (the `blind`
 *  shape in `useVsAiDriver`), so "a decklist exists for this seat" is true on
 *  `easy` as readily as on `expert`. What is true only at `expert`
 *  (`DIFFICULTY_KNOWS_OPPONENT`, `gre/difficulty.ts`) is that a decklist exists
 *  for a seat the searcher is not sitting in — and `evaluate` runs from BOTH
 *  seats' viewpoints inside one search (`materialMargin(state, moverId)`,
 *  `policyValue(fired, pid, …)`), so a gate that missed this would have
 *  sharpened the estimate of the BOT's own colours at every difficulty.
 *
 *  `undefined` when there is nothing to stamp, so the caller can leave the
 *  state object untouched and byte-identical on every non-expert path. */
export function deckColorsForSearch(
    deckKnowledge: DeckKnowledgeBySeat | undefined,
    observerId: string
): DeckColorsBySeat | undefined {
    const out: DeckColorsBySeat = [];
    for (const seat of deckKnowledge ?? []) {
        if (seat.playerId === observerId) continue;
        out.push({
            playerId: seat.playerId,
            colors: deckColorEvidence(seat.cardIds),
        });
    }
    return out.length > 0 ? out : undefined;
}

/** This seat's decklist colour evidence, if the search was granted any for it.
 *  Absence is the fail-closed answer and the ONLY discriminator — exactly as
 *  for {@link knowledgeFor}, whose gate this one inherits. */
export function deckColorsFor(
    deckColors: DeckColorsBySeat | undefined,
    playerId: string
): DeckColorEvidence | undefined {
    return deckColors?.find((c) => c.playerId === playerId)?.colors;
}
