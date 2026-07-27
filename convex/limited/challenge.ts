// Limited Event human-vs-human challenge (issue #1577): the pure validation +
// projection seam between two seated humans wanting to play their built Limited
// decks against each other, and the DB shell (`convex/game.ts`'s
// `challengeLimitedSeat` / `joinGame`, `convex/limitedEvents.ts`'s event
// projection). Every decision here is a plain function of plain data (project
// convention: no convex-test harness, see
// `convex/__tests__/limitedDeckbuild.test.ts`), so the mutations stay thin
// DB-read/write shells around it.

import type { SeatLookup } from "./poolResolution";

/**
 * Validates that `challengedSeatIndex` names a seated HUMAN opponent the
 * authenticated challenger may challenge in `event`, returning that seat.
 * Throws (message safe to surface to the client) when the target seat is
 * missing, a bot, empty (no occupant), or the challenger's own seat.
 * `challengerUserId` is always the AUTHENTICATED caller (`getCurrentUserId`),
 * never a client claim — so a challenge can never be attributed to someone
 * else.
 */
export function assertChallengeableSeat(
    event: { seats: readonly SeatLookup[] } | null,
    challengedSeatIndex: number,
    challengerUserId: string
): SeatLookup {
    if (!event) throw new Error("Limited Event not found.");
    const seat = event.seats.find((s) => s.seatIndex === challengedSeatIndex);
    if (!seat || seat.isBot || !seat.userId) {
        throw new Error("You can only challenge a seated human opponent.");
    }
    if (seat.userId === challengerUserId) {
        throw new Error("You cannot challenge your own seat.");
    }
    return seat;
}

/**
 * Both paired decks MUST belong to the same Limited Event (issue #1577 AC:
 * "pairing decks from different events is rejected server-side"). Enforced at
 * two points against the SAME rule: at challenge time the challenger's
 * `deck.limitedEventId` must equal the event being challenged in, and at accept
 * time the joiner's `deck.limitedEventId` must equal the challenge's bound
 * event (`games.limitedEventId`). Throws for a mismatch OR a non-Limited deck
 * (`undefined` eventId) — a challenge is only ever between two Limited decks.
 */
export function assertSameEventDeck(
    deckEventId: string | undefined,
    expectedEventId: string
): void {
    if (deckEventId !== expectedEventId) {
        throw new Error(
            "Your deck must belong to the same Limited Event as the challenge."
        );
    }
}

/** A pending challenge Game bound to an event, flattened for projection — one
 *  per `waiting` `games` row that carries a `limitedChallenge`. */
export interface ChallengeGame {
    gameId: string;
    /** The Match this waiting Game belongs to (`games.matchId`). Carried so a
     *  consumer can tell WHICH pending challenge it is looking at — see
     *  `ViewerIncomingChallenge.matchId`. */
    matchId: string;
    /** The challenger's user id (the sole player already seated in the waiting
     *  Game — `games.players[0].id` for a 2-player Match). */
    challengerUserId: string;
    challengerSeatIndex: number;
    challengedUserId: string;
    challengedSeatIndex: number;
}

/** A challenge addressed TO the viewer — the viewer accepts it with their own
 *  Limited deck (`joinGame`). */
export interface ViewerIncomingChallenge {
    gameId: string;
    /** The Match the challenge Game belongs to (issue #1645 review). The
     *  ROUND-pairing affordance identifies its own Match by comparing this to
     *  the pairing's `matchId`: a FREE challenge sent by the same seat during
     *  deckbuild is still `waiting` when the phase flips to `playing`, and
     *  `challengerSeatIndex` alone cannot tell the two apart — so the viewer
     *  was being offered the stale free challenge as their round Match, which
     *  joins an UNRECORDED game and burns the single-active-Match slot the real
     *  pairing needs. (Hiding free play once rounds start is #1648's job.) */
    matchId: string;
    challengerSeatIndex: number;
}

/** The viewer's own OUTSTANDING challenge (at most one — the active-match guard
 *  in `challengeLimitedSeat` prevents a second). */
export interface ViewerOutgoingChallenge {
    gameId: string;
    challengedSeatIndex: number;
}

export interface ViewerChallenges {
    incoming: ViewerIncomingChallenge[];
    outgoing: ViewerOutgoingChallenge | null;
}

/**
 * Viewer-scoped projection of an event's pending challenges (issue #1577) —
 * the SAME "own business only" discipline as the rest of the event projection
 * (`projectLimitedEvent`): a viewer sees challenges addressed TO them
 * (`incoming`) and their OWN outstanding challenge (`outgoing`), never the
 * pairing of two OTHER seats. Pure — unit-tested through the same seam the
 * client receives (never a hand-built view). `viewerUserId` is `null` for an
 * anonymous read → nothing to show.
 */
export function projectViewerChallenges(
    challenges: readonly ChallengeGame[],
    viewerUserId: string | null
): ViewerChallenges {
    if (viewerUserId === null) return { incoming: [], outgoing: null };
    const incoming = challenges
        .filter((c) => c.challengedUserId === viewerUserId)
        .map((c) => ({
            gameId: c.gameId,
            matchId: c.matchId,
            challengerSeatIndex: c.challengerSeatIndex,
        }));
    const outgoingGame = challenges.find(
        (c) => c.challengerUserId === viewerUserId
    );
    const outgoing = outgoingGame
        ? {
              gameId: outgoingGame.gameId,
              challengedSeatIndex: outgoingGame.challengedSeatIndex,
          }
        : null;
    return { incoming, outgoing };
}
