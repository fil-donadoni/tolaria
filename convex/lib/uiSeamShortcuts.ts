/**
 * The decisions behind the `check:ui` seam's lane shortcuts (issue #9272),
 * pure so they are tested without a Convex runtime: which game a declared
 * position may be loaded into, when a repeat load is free, and which deck a
 * Limited fixture seat saves. `convex/uiSeam.ts` gates the caller and does the
 * reads and writes around them.
 */
import { tryGetDefinition } from "../cards";
import { getCardColorIdentity } from "../cards/colors";
import type { LimitedPoolCard } from "../limited/eventTypes";

/** The one game shape a declared position may be loaded into: the caller's
 *  active SOLO game, past its pregame. A two-seat game (the run's join table)
 *  has a real second account in it; a `waiting` game has no snapshot yet. */
export function isLanePositionGame(
    game: { solo?: boolean; status: string } | null
): boolean {
    return game !== null && game.solo === true && game.status === "playing";
}

/** True when the guarded game still stands at the guarded `seq`: nothing has
 *  been saved since the load that returned them, so the board IS that
 *  position and rebuilding it would change nothing. */
export function positionStillLoaded(
    unlessAt: { gameId: string; seq: number } | undefined,
    game: { gameId: string; seq: number }
): boolean {
    return (
        unlessAt !== undefined &&
        unlessAt.gameId === game.gameId &&
        unlessAt.seq === game.seq
    );
}

/** WUBRG, the order a builder save stores a deck's colours in. */
const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;

/**
 * The deck a builder "Done" saves from a draft seat's untouched Pool: every
 * Pool card in the Maindeck (no Pool Arrangement puts any aside,
 * `continuousWorkingDeck`), an empty Sideboard, and the colour identity of
 * the cards in WUBRG order (`computeDeckColors`, registry-only). The seat
 * reference binds it to the seat, as the builder's save does.
 */
export function fixtureSeatDeck(
    pool: readonly LimitedPoolCard[],
    seat: { eventId: string; seatIndex: number },
    name: string
) {
    const colors = new Set<string>();
    for (const card of pool) {
        const def = tryGetDefinition(card.scryfallId);
        for (const c of def ? getCardColorIdentity(def) : []) colors.add(c);
    }
    return {
        name,
        format: "limited" as const,
        colors: COLOR_ORDER.filter((c) => colors.has(c)),
        cards: pool.map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
        sideboard: [],
        limitedEventId: seat.eventId,
        limitedSeatId: String(seat.seatIndex),
    };
}
