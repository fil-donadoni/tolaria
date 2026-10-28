// Deck Pool (ADR 0106): a `limited` deck's own copy of its Seat's Pool, the
// only Pool any validation of that deck reads. This module is the pure half —
// the write-vs-skip decision and the backfill planner — so
// `convex/limitedDeckPoolStore.ts` stays a thin DB shell around it (project
// convention: no convex-test harness, plain functions of plain data).

import type { LimitedPoolCard } from "./eventTypes";

/** One stored Deck Pool: one entry per physical card, the Seat's Pool verbatim
 *  (`scryfallId` + the `cardId`/`cardName` the producer resolved). Stored
 *  expanded rather than interned, so a later catalogue change can never
 *  re-key a saved deck's Pool and make the deck illegal against itself. */
export type DeckPoolCards = readonly LimitedPoolCard[];

/** A Pool rebuilt as fresh literals in a FIXED key order — what is written,
 *  and what makes the identical-payload check below safe through
 *  `JSON.stringify` (same discipline as `limitedSeatStore`'s `internPayload`). */
export function canonicalDeckPool(cards: DeckPoolCards): LimitedPoolCard[] {
    return cards.map((c) => ({
        scryfallId: c.scryfallId,
        cardId: c.cardId,
        cardName: c.cardName,
    }));
}

/** True when saving `next` must write: no Deck Pool stored yet, or a payload
 *  that differs from the stored one. During a Draft the Pool grows and every
 *  save refreshes the copy; once picking ends the payload stops changing and
 *  so do the writes. Order is significant — the Pool is an ordered list whose
 *  indices the Pool Arrangement keys on. */
export function deckPoolNeedsWrite(
    stored: DeckPoolCards | null,
    next: DeckPoolCards
): boolean {
    if (stored === null) return true;
    return (
        JSON.stringify(canonicalDeckPool(stored)) !==
        JSON.stringify(canonicalDeckPool(next))
    );
}

/** What the backfill knows about one `limited` deck: whether it already owns
 *  a Deck Pool, and its Seat's Pool if the event and seat still resolve. */
export interface DeckPoolBackfillInput {
    deckId: string;
    hasDeckPool: boolean;
    seatPool: DeckPoolCards | null;
}

export interface DeckPoolBackfillPlan {
    /** Decks to give a Deck Pool, copied from their still-resolving Seat. */
    backfill: { deckId: string; pool: DeckPoolCards }[];
    /** Decks already owning one — left untouched, which makes a re-run a
     *  no-op. */
    present: string[];
    /** Decks with no Deck Pool and no recoverable Seat Pool: reported, never
     *  deleted here (their deletion is a separate decision). */
    unrecoverable: string[];
}

/** Classifies every `limited` deck for the one-shot Deck Pool backfill. */
export function planDeckPoolBackfill(
    rows: readonly DeckPoolBackfillInput[]
): DeckPoolBackfillPlan {
    const plan: DeckPoolBackfillPlan = {
        backfill: [],
        present: [],
        unrecoverable: [],
    };
    for (const row of rows) {
        if (row.hasDeckPool) plan.present.push(row.deckId);
        else if (row.seatPool !== null)
            plan.backfill.push({ deckId: row.deckId, pool: row.seatPool });
        else plan.unrecoverable.push(row.deckId);
    }
    return plan;
}
