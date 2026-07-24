// Event completion (PRD #1107 story 26, ADR 0054/0055, issue #1116): a
// Limited Event reaches "completed" exactly when every Seat has a Deck —
// bots via Auto-Build (issue #1115, always computable the instant the
// Seat's Pool is final) and humans via their own submitted `userDecks` row
// (issue #1111). PURE — like every other decision in this domain
// (`eventLogic.ts`, `autoBuild.ts`), a function of plain data, unit-testable
// without a convex-test harness (the project has none, see
// `convex/__tests__/adminAuth.test.ts`). "Has a deck" here means EXISTENCE
// only, not legality — the AC is "every seat has a deck", not "every seat
// has a LEGAL deck" (a human's live legality feedback is the deckbuilder's
// job, `poolResolution.ts`'s `resolveLimitedDeckLegality`).
import { isEventPoolFinal, type AutoBuildEventContext } from "./autoBuild";

/** The minimal Seat shape completion needs — structural, like
 *  `poolResolution.ts`'s `SeatLookup`, so this module never depends on
 *  `Doc<"limitedEvents">` or the Convex-coupled `LimitedEventSeat`. */
export interface CompletionSeatLookup {
    seatIndex: number;
    isBot?: boolean;
}

/** Does the human occupying `seatIndex` have a submitted `limited` deck for
 *  THIS event? Injected — deck existence lives on the separate `userDecks`
 *  table (`by_limitedEvent` index), a DB read this pure module never performs
 *  itself (mirrors `ChooseBotPick`/`GetAutoBuildCardMeta`'s injection
 *  discipline elsewhere in `convex/limited/**`). Never consulted for a bot
 *  seat — see `computeEventCompletion` below. */
export type HasHumanDeck = (seatIndex: number) => boolean;

export interface EventCompletionResult {
    /** True iff the Pool is final AND every seat (bot or human) has a deck. */
    completed: boolean;
    /** How many seats currently have a deck — for a "3/4 decks in" progress
     *  readout while the event is still in progress. */
    seatsWithDeck: number;
    seatsTotal: number;
    /** Per-seat "has a deck" readiness (issue #1580) — the seat-index set a
     *  caller threads into `projectLimitedEvent`'s `hasDeckBySeat` param so
     *  each seat row can show a ready indicator WITHOUT leaking WHICH deck
     *  (contents stay gated on `completed`, same as `pool`/`humanDeck`). A
     *  bot seat is a member as soon as the Pool is final (mirrors
     *  `seatsWithDeck`'s "bots free" rule above); a human seat is a member
     *  once `hasHumanDeck(seatIndex)` reports a real submitted deck. */
    hasDeckBySeat: ReadonlySet<number>;
}

/** Computes whether `seats` have all reached "has a deck" (issue #1116 AC:
 *  "Event reaches a completed state exactly when every seat has a deck —
 *  humans submitted, bots auto-built"). A bot seat counts as soon as the
 *  event's Pool is final (`isEventPoolFinal` — the exact gate
 *  `computeBotAutoBuiltDeck` already uses, issue #1115): its deck is always
 *  COMPUTABLE at that point, never a separately-submitted artifact. A human
 *  seat counts only once `hasHumanDeck(seatIndex)` reports a real submitted
 *  `userDecks` row. An event with zero seats is never "completed" (nothing
 *  to study, and `seats.every(...)` on an empty array would otherwise
 *  vacuously report `true`). */
export function computeEventCompletion(
    seats: readonly CompletionSeatLookup[],
    eventContext: AutoBuildEventContext,
    hasHumanDeck: HasHumanDeck
): EventCompletionResult {
    const seatsTotal = seats.length;
    if (seatsTotal === 0) {
        return {
            completed: false,
            seatsWithDeck: 0,
            seatsTotal: 0,
            hasDeckBySeat: new Set(),
        };
    }
    const poolFinal = isEventPoolFinal(eventContext);
    let seatsWithDeck = 0;
    const hasDeckBySeat = new Set<number>();
    for (const seat of seats) {
        const hasDeck =
            poolFinal && (seat.isBot ? true : hasHumanDeck(seat.seatIndex));
        if (hasDeck) {
            seatsWithDeck++;
            hasDeckBySeat.add(seat.seatIndex);
        }
    }
    return {
        completed: seatsWithDeck === seatsTotal,
        seatsWithDeck,
        seatsTotal,
        hasDeckBySeat,
    };
}

// Re-exported so callers that only need the completion seam don't have to
// import `autoBuild.ts` separately just for the event-context shape.
export type { AutoBuildEventContext };
