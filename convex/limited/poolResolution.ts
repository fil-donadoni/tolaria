// Limited deckbuilding: Pool resolution + seat ownership (PRD #1107, ADR
// 0054/0055, issue #1111). This is the pure seam between the `limitedEvents`
// DB row (a seat's authoritative, opened Pool of `LimitedPoolCard[]`) and
// `convex/formats.ts`'s legality-side `Pool`/`ResolvePool` shape — kept
// separate from both so neither module needs to know about the other's
// storage details. Every non-trivial decision here is a plain function of
// plain data (project convention: no convex-test harness, see
// `convex/__tests__/decks.test.ts`), so `convex/userDecks.ts` and
// `convex/game.ts` stay thin DB-read/write shells around it.

import { resolveDeckCardMeta } from "../cards";
import {
    checkPoolMembership,
    validateDeck,
    type DeckLegality,
    type Pool,
    type PoolCard,
    type Reason,
    type ResolveCard,
    type ResolvePool,
    type ValidatableDeck,
} from "../formats";
import type { LimitedPoolCard } from "./eventTypes";

/** The minimal Seat shape every function below needs — a structural subset of
 *  `Doc<"limitedEvents">["seats"][number]` (and of the pure
 *  `LimitedEventSeat`), so this module never depends on either's exact type
 *  (in particular, never on `Id<"users">` vs the opaque-string convention). */
export interface SeatLookup {
    seatIndex: number;
    userId?: string;
    /** Bot-drafter seat (issue #1115) — a challenge (issue #1577) may target
     *  only a seated HUMAN, so the challenge gate reads this. Optional so every
     *  pre-existing plain-data fixture stays structurally compatible. */
    isBot?: boolean;
    /** Dropped from the started event (`droppedSeat.ts`): nobody is left to
     *  accept a challenge. */
    droppedAt?: number;
    /** Display name of the seat's occupant, when known. */
    nickname?: string;
    pool?: readonly LimitedPoolCard[];
}

/**
 * Groups a seat's flat, one-entry-per-physical-card Pool into the
 * legality-side `Pool` shape (`convex/formats.ts`) — canonical Card ID
 * multiset. Basics are dropped (never pooled, ADR 0054/0055: "the format
 * lets a builder add unlimited basics regardless of the Pool"), mirroring
 * `buildPool`'s own basic exemption exactly. Every `LimitedPoolCard.cardId`
 * is already the canonical id (`generateSealedPools` resolved it at deal
 * time via `ResolveCardMeta`), so no re-canonicalization is needed here —
 * only the basic-ness lookup.
 */
export function poolFromLimitedPoolCards(
    cards: readonly LimitedPoolCard[],
    resolve: ResolveCard = resolveDeckCardMeta
): Pool {
    const counts = new Map<string, PoolCard>();
    for (const card of cards) {
        const meta = resolve(card.cardId);
        if (meta?.isBasic) continue; // basics are never pooled
        const existing = counts.get(card.cardId);
        if (existing) {
            existing.count += 1;
        } else {
            counts.set(card.cardId, {
                cardId: card.cardId,
                cardName: card.cardName,
                count: 1,
            });
        }
    }
    return { cards: [...counts.values()] };
}

/** Is `userId` the occupant of `seatIndex`? The single check that makes
 *  "a user builds only in their OWN seat" true — every caller resolves the
 *  seat from the AUTHENTICATED userId (`getCurrentUserId(ctx)`), never from
 *  an unchecked client-supplied seat id. */
export function seatOwnedByUser(
    seats: readonly SeatLookup[],
    seatIndex: number,
    userId: string
): boolean {
    const seat = seats.find((s) => s.seatIndex === seatIndex);
    return seat !== undefined && seat.userId === userId;
}

/** The seat's authoritative opened Pool (raw `LimitedPoolCard[]`), or `null`
 *  when the seat doesn't exist or hasn't been dealt one yet (event not
 *  started). */
export function findSeatPool(
    seats: readonly SeatLookup[],
    seatIndex: number
): readonly LimitedPoolCard[] | null {
    const seat = seats.find((s) => s.seatIndex === seatIndex);
    return seat?.pool ?? null;
}

/**
 * The seat-ownership gate for persisting a `limited` user deck (issue #1111
 * AC: "a user builds only in their OWN seat — server-derive userId, never
 * trust client seat id"). `event` is `null` for an unresolvable
 * `limitedEventId`; `seatIdRaw` is the deck's stored `limitedSeatId` (a
 * stringified `seatIndex`, ADR 0054/0055's opaque-string convention). Throws
 * with a message safe to surface to the client — never a silent pass.
 */
export function assertLimitedSeatOwnership(
    event: { seats: readonly SeatLookup[] } | null,
    seatIdRaw: string,
    userId: string
): asserts event is { seats: readonly SeatLookup[] } {
    if (!event) throw new Error("Limited Event not found.");
    const seatIndex = Number(seatIdRaw);
    if (
        !Number.isInteger(seatIndex) ||
        !seatOwnedByUser(event.seats, seatIndex, userId)
    ) {
        throw new Error("You do not occupy this Limited Event seat.");
    }
}

/**
 * Resolves the WORKING Pool of a Seat from its already-fetched event row +
 * stored `limitedSeatId`. Not a saved deck's legality source — that is the
 * deck's own Deck Pool (ADR 0106, `convex/limitedDeckPoolStore.ts`); this
 * serves only the live in-event surface where the Seat itself is the Pool
 * being built from. `event: null` or a seat with no Pool yet resolve to
 * `null` — a hard legality failure (`pool-unresolved`), never a silent pass.
 */
export function resolvePoolFromEvent(
    event: { seats: readonly SeatLookup[] } | null,
    seatIdRaw: string,
    resolve: ResolveCard = resolveDeckCardMeta
): Pool | null {
    if (!event) return null;
    const seatIndex = Number(seatIdRaw);
    if (!Number.isInteger(seatIndex)) return null;
    const pool = findSeatPool(event.seats, seatIndex);
    return pool ? poolFromLimitedPoolCards(pool, resolve) : null;
}

/**
 * Pure legality computation for a saved `limited` deck against its Deck Pool
 * (ADR 0106) — the ONLY Pool a saved deck validates against, so
 * `userDecks.listMine` attaches an `isLegal` that holds after the deck's event
 * is gone. `null` (no Deck Pool) is `pool-unresolved`, never a pass.
 */
export function resolveLimitedDeckLegality(
    deck: ValidatableDeck,
    deckPool: readonly LimitedPoolCard[] | null,
    resolve: ResolveCard = resolveDeckCardMeta
): DeckLegality {
    const resolvePool: ResolvePool = () =>
        deckPool ? poolFromLimitedPoolCards(deckPool, resolve) : null;
    return validateDeck(deck, "limited", resolve, undefined, resolvePool);
}

type DeckCard = ValidatableDeck["cards"][number];

/** Non-basic copies per canonical Card ID across Maindeck + Sideboard — the
 *  same counting `checkPoolMembership` does, so "introduced" and "ungranted"
 *  agree on what a card is. An unresolvable id keeps its raw id. */
function countCopies(
    zones: readonly (readonly DeckCard[] | undefined)[],
    resolve: ResolveCard
): Map<string, { cardName: string; count: number }> {
    const counts = new Map<string, { cardName: string; count: number }>();
    for (const card of zones.flatMap((zone) => zone ?? [])) {
        const meta = resolve(card.cardId);
        if (meta?.isBasic) continue; // basics are free in Limited
        const cardId = meta?.cardId ?? card.cardId;
        const entry = counts.get(cardId);
        if (entry) entry.count += 1;
        else counts.set(cardId, { cardName: card.cardName, count: 1 });
    }
    return counts;
}

/**
 * The edit guard for a saved `limited` deck (issue #2816): the reasons a patch
 * INTRODUCES cards its Deck Pool does not account for. Blocks introductions,
 * never saves — a card whose copy count does not rise (moved between zones, or
 * removed) is never judged, so a deck already illegal from an old editor can
 * be saved back into legality. The membership decision is
 * `checkPoolMembership`, run over a probe deck holding only the risen cards;
 * its `pool-card-unplaced` reasons are dropped (the probe omits most of the
 * deck by construction). `deckPool: null` (no Pool to judge against) refuses
 * every introduction, fail-closed like `pool-unresolved`.
 */
export function findPoolIntroductions(
    before: { cards: DeckCard[]; sideboard?: DeckCard[] },
    after: { cards: DeckCard[]; sideboard?: DeckCard[] },
    deckPool: readonly LimitedPoolCard[] | null,
    resolve: ResolveCard = resolveDeckCardMeta
): Reason[] {
    const was = countCopies([before.cards, before.sideboard], resolve);
    const probe: DeckCard[] = [];
    for (const [cardId, { cardName, count }] of countCopies(
        [after.cards, after.sideboard],
        resolve
    )) {
        if (count <= (was.get(cardId)?.count ?? 0)) continue;
        for (let i = 0; i < count; i++) probe.push({ cardId, cardName });
    }
    if (probe.length === 0) return [];
    if (deckPool === null) {
        return [
            {
                code: "pool-unresolved",
                message:
                    "This Limited deck has no resolvable Deck Pool, so cards cannot be added.",
            },
        ];
    }
    return checkPoolMembership(
        { cards: probe },
        poolFromLimitedPoolCards(deckPool, resolve),
        resolve
    ).filter((r) => r.code !== "pool-card-unplaced");
}
