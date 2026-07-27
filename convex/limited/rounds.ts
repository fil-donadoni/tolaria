// Round state (PRD #1628, ADR 0076, issue #1644) — the pure module that turns
// "the table is ready" into "round N is open and every pairing nobody can sit
// down and play is already decided".
//
// The discipline is the one the rest of `convex/limited/**` already follows and
// ADR 0076 restates for the play phase: the DOMAIN decision is a pure function
// of plain data, and the Convex mutation is a thin shell that reads the row,
// calls this, and writes the result back. Nothing here touches `ctx`, the DB,
// `Math.random` or the clock.
//
// **Deterministic by identity, not by an injected stream.** Unlike `pairRound`
// (which takes an `rng` because a *seed* is not part of a pairing's identity),
// `openRound` derives BOTH of its random streams from the round's own identity
// — `(eventId, roundNumber)` for the pairing, `(eventId, roundNumber, seatA,
// seatB)` for each simulated bot match, the seam `matchSim.ts#botMatchSeed`
// already owns. That is what makes issue #1644's acceptance criterion
// "re-running the projection (or reloading the page) never changes an
// already-recorded simulated result" true by construction rather than by
// remembering to persist first: opening the same round of the same event twice
// produces byte-identical pairings and byte-identical simulated results.
//
// Scope note: this ticket opens a round. Recording a PLAYED result, expiring a
// round on its deadline and advancing to the next one are the neighbouring
// slices of the same PRD; `isRoundComplete`/`findSeatPairing` below are the
// read-side primitives they and the UI share.

import { makeRng } from "../gre/rng";
import type { LimitedPairing, LimitedRound } from "./eventTypes";
import {
    bestOfForMatchFormat,
    gamesToWinMatch,
    type LimitedMatchFormat,
} from "./matchFormat";
import {
    fnv1a32,
    simulateBotMatch,
    type DeckStrength,
    botMatchSeed,
} from "./matchSim";
import { pairRound } from "./swiss";

/** The minimal Seat shape opening a round needs: which seats exist and which
 *  of them nobody is sitting at. Structural (like `completion.ts`'s
 *  `CompletionSeatLookup` and `standings.ts`'s `StandingsSeatLookup`) so this
 *  module never depends on `Doc<"limitedEvents">`. */
export interface RoundSeatLookup {
    seatIndex: number;
    isBot?: boolean;
}

/** A bot seat's evaluated deck strength (`matchSim.ts#evaluateDeckStrength`).
 *  INJECTED, because computing it needs the seat's Auto-Built deck, the card
 *  registry and the event's Pick Ratings — three DB/registry reads this module
 *  must not perform. Only ever asked for a seat with `isBot: true`. */
export type ResolveSeatStrength = (seatIndex: number) => DeckStrength;

export interface OpenRoundInput {
    /** The event's id — part of every seed derived below, so two events that
     *  happen to have identical seats and identical prior rounds still pair
     *  and simulate differently. */
    eventId: string;
    /** 1-based round being opened. */
    roundNumber: number;
    seats: readonly RoundSeatLookup[];
    /** Every round already played, in order. Must be fully decided —
     *  `pairRound` throws otherwise, which is the correct failure: pairing
     *  round N+1 against an undecided round N would ignore results that are
     *  about to land. */
    previousRounds: readonly LimitedRound[];
    matchFormat: LimitedMatchFormat;
    /** Epoch ms the round starts (the mutation's `Date.now()`). Injected — a
     *  pure function never reads the clock. */
    startedAt: number;
    /** The event's configured round deadline, in minutes. Absent = the event
     *  has no deadline and the round never expires (PRD #1628 story 4). */
    roundDeadlineMinutes?: number;
    seatStrength: ResolveSeatStrength;
}

/** Derives the pairing RNG's seed from the round's identity. Owned here for
 *  the same reason `botMatchSeed` is owned by `matchSim.ts`: every path that
 *  opens the same round of the same event must land on the same stream, so a
 *  retry, a replay or a future admin re-derivation cannot produce a DIFFERENT
 *  round-1 bracket than the one the table actually played. */
export function roundPairingSeed(eventId: string, roundNumber: number): number {
    return fnv1a32(`${eventId}:round:${roundNumber}`);
}

/** Is `seat` a seat nobody is sitting at? A seat with no `userId` and no
 *  `isBot` flag cannot exist once the event has started (`startLimitedEvent`
 *  fills every empty seat with a Bot Drafter), but treating "not a bot" as
 *  "human" is the safe direction: a mis-flagged seat's pairing waits for a
 *  human instead of being silently decided by a simulation. */
function isBotSeat(seat: RoundSeatLookup): boolean {
    return seat.isBot === true;
}

/** Opens one Swiss round (issue #1644): pairs every seat, then decides — in
 *  this same call — every pairing that no human will ever play.
 *
 *  - **Bye** (odd seat count, `seatB` absent): recorded immediately as a match
 *    WIN worth the games the format is worth (PRD story 28 — `gamesToWinMatch`,
 *    so a Bo3 bye is 2-0 and a Bo1 bye 1-0), `source: "bye"`. Which seat gets
 *    it, and the "never twice in one event" guarantee, are `pairRound`'s
 *    (PRD story 27).
 *  - **Bot vs bot**: resolved immediately through `simulateBotMatch` against
 *    both seats' evaluated deck strength, `source: "simulated"` (ADR 0076
 *    decision 3 — evaluated, never played through the GRE). Seeded from the
 *    pairing's identity, so the result is stable forever.
 *  - **Anything involving a human**: left UNDECIDED. Creating the Match and
 *    recording its result belong to the neighbouring slices.
 *
 *  A round with no human pairing at all therefore comes back fully decided —
 *  which is exactly what lets the next slice cascade straight into the
 *  following round. */
export function openRound(input: OpenRoundInput): LimitedRound {
    const {
        eventId,
        roundNumber,
        seats,
        previousRounds,
        matchFormat,
        startedAt,
        roundDeadlineMinutes,
        seatStrength,
    } = input;

    const botSeats = new Set(
        seats.filter(isBotSeat).map((seat) => seat.seatIndex)
    );
    const seatIndexes = seats.map((seat) => seat.seatIndex);

    const rng = makeRng(roundPairingSeed(eventId, roundNumber));
    const paired = pairRound(seatIndexes, previousRounds, rng);
    const bestOf = bestOfForMatchFormat(matchFormat);

    const pairings: LimitedPairing[] = paired.map(({ seatA, seatB }) => {
        if (seatB === undefined) {
            return {
                seatA,
                result: {
                    winsA: gamesToWinMatch(matchFormat),
                    winsB: 0,
                    source: "bye" as const,
                },
            };
        }
        if (!botSeats.has(seatA) || !botSeats.has(seatB)) {
            // At least one human is in this pairing — it waits to be played.
            return { seatA, seatB };
        }
        const { winsA, winsB } = simulateBotMatch(
            seatStrength(seatA),
            seatStrength(seatB),
            bestOf,
            makeRng(botMatchSeed(eventId, roundNumber, seatA, seatB))
        );
        return {
            seatA,
            seatB,
            result: { winsA, winsB, source: "simulated" as const },
        };
    });

    return {
        roundNumber,
        startedAt,
        // No configured deadline = the round never expires (PRD story 4).
        deadlineAt:
            roundDeadlineMinutes === undefined
                ? undefined
                : startedAt + roundDeadlineMinutes * 60_000,
        pairings,
    };
}

/** Is every pairing of `round` decided? The read-side primitive the round
 *  panel uses to say "waiting on another seat", and the gate the (next slice's)
 *  round advance is built on. */
export function isRoundComplete(round: LimitedRound): boolean {
    return round.pairings.every((pairing) => pairing.result !== undefined);
}

/** The pairing `seatIndex` is in, or `null` if the seat isn't in this round at
 *  all (which only happens for a seat that isn't part of the event). A seat is
 *  in at most one pairing per round — `pairRound` produces a partition — so
 *  the first match is the answer. */
export function findSeatPairing(
    round: LimitedRound,
    seatIndex: number
): LimitedPairing | null {
    return (
        round.pairings.find(
            (pairing) =>
                pairing.seatA === seatIndex || pairing.seatB === seatIndex
        ) ?? null
    );
}
