// The pure half of the DETACHED pool deckbuilder (ADR 0106): a saved `limited`
// deck rebuilt from its own Deck Pool, with no Seat in reach. Every Pin lives on
// the deck row here, and the whole Pool must end up on offer, because legality
// asks for exactly that (`checkPoolMembership`).
import type { StoredDeckColumnLayout } from "@convex/deckLayout";
import { resolveDeckCardMeta } from "@convex/cards/catalogue";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import {
    assignPoolCopies,
    openedPrintId,
    type PlainPoolCard,
} from "@convex/limited/poolArrangement";
import type { DeckCard, ZoneCard } from "~/types/game";
import { basicLandSubtypeOf } from "./basicLands";

/** The deck row's Maindeck Pins in the shape `assignPoolCopies` reads, so a
 *  pinned copy is re-attached to the Maindeck after a reload exactly as a Seat's
 *  is. A key that names no Pool copy (a Pin the constructed builder recorded
 *  under a card id) is left out: it resolves to nothing. */
export function arrangementFromDeckLayout(
    layout: StoredDeckColumnLayout | undefined
): PoolArrangementEntry[] {
    const entries: PoolArrangementEntry[] = [];
    for (const [key, pins] of Object.entries(layout?.maindeck?.pins ?? {})) {
        const poolIndex = Number(key);
        if (Number.isInteger(poolIndex)) entries.push({ poolIndex, pins });
    }
    return entries;
}

export interface DetachedZones {
    cards: PlainPoolCard[];
    sideboard: PlainPoolCard[];
    /** How many Pool copies the saved row did not place, now in the Sideboard.
     *  The row is illegal until they are written back (`pool-card-unplaced`). */
    unplacedCount: number;
}

/** A saved deck's zones re-attached to its Deck Pool. Every non-basic copy the
 *  row does not place joins the Sideboard: at Limited the Pool IS the
 *  Sideboard, and a Pool card the old editor dropped would otherwise be neither
 *  on offer nor placeable. A Pool Basic stays out, since Basics are exempt from
 *  the Pool and the builder removes them freely. */
export function detachedZones(
    pool: readonly LimitedPoolCard[],
    saved: {
        cards: readonly DeckCard[];
        sideboard: readonly DeckCard[];
        layout?: StoredDeckColumnLayout;
    }
): DetachedZones {
    const { cards, sideboard } = assignPoolCopies(
        pool,
        arrangementFromDeckLayout(saved.layout),
        saved
    );
    const placed = new Set(
        [...cards, ...sideboard].map((card) => card.poolIndex)
    );
    const unplaced: PlainPoolCard[] = [];
    pool.forEach((card, poolIndex) => {
        if (placed.has(poolIndex)) return;
        if (resolveDeckCardMeta(card.cardId)?.isBasic) return;
        unplaced.push({
            cardId: card.cardId,
            cardName: card.cardName,
            printId: openedPrintId(card),
            poolIndex,
        });
    });
    return {
        cards,
        sideboard: [...sideboard, ...unplaced],
        unplacedCount: unplaced.length,
    };
}

/** The index of the zone entry a gesture names when that entry is a card the
 *  Deck Pool does not account for (non-Basic, no Pool copy), else `-1`. Such a
 *  card has no legal zone, so the gesture removes it: that is how a deck the old
 *  editor made illegal is repaired. A drag reports a keyless entry's `pinKey` as
 *  its `cardId`; any other `pinKey` names a Pool copy and is never off-Pool. */
export function offPoolEntryIndex(
    zone: readonly ZoneCard[],
    cardId: string,
    pinKey: string | undefined
): number {
    if (pinKey !== undefined && pinKey !== cardId) return -1;
    return zone.findIndex(
        (card) =>
            card.cardId === cardId &&
            card.pinKey === undefined &&
            basicLandSubtypeOf(card.cardId, card) === null
    );
}
