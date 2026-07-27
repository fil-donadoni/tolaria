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
import { pairRound, roundsForSeatCount } from "./swiss";

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

/** Closes `roundNumber`'s undecided pairings against the round deadline
 *  (PRD #1628 stories 32-35, issue #1647). Pure — no DB, no clock beyond the
 *  injected `now` — mirroring `advanceRoundIfComplete`'s own discipline: the
 *  mutation shell (`convex/limitedEvents.ts`'s `expireRoundDeadline`) is what
 *  decides WHEN to call this; this only decides WHAT closing the round means.
 *
 *  Every pairing that already has a `result` is left byte-identical (issue
 *  #1647 AC "an already-decided pairing is never rewritten by the expiry") —
 *  including a round that was played through in full before its deadline
 *  fired, and a bye/simulated pairing `openRound` already decided on the
 *  spot. Three no-op guards, each independently sufficient for the AC "an
 *  event with no deadline configured never auto-closes a pairing" and for
 *  the round-level idempotency the scheduler's staleness check relies on:
 *  no configured deadline, the deadline hasn't actually elapsed yet, or the
 *  round is already fully decided.
 *
 *  What "undecided at the deadline" closes to (PRD stories 32-34):
 *  - **Human vs bot**: the bot side never "shows up" as such — a human/bot
 *    pairing only decides once the human calls `startPairingMatch` (issue
 *    #1645), so an undecided one at the deadline means the human never
 *    played. Scored as a loss for the human, 0 to `gamesToWinMatch`, the
 *    SAME games a bye/win is worth for this format.
 *  - **Human vs human, still undecided**: this module has no visibility into
 *    which side (if either) actually joined the pairing's bound Match — that
 *    would need the `matches` row's own per-player join state, a DB read a
 *    pure round function deliberately never performs (see file header).
 *    Story 34's rule ("NEITHER human showed up") is applied to every
 *    undecided human-vs-human pairing at the hard deadline cutoff: a double
 *    loss (equal wins, `source: "timeout"` — `classifyPairingResult`,
 *    `convex/limited/standings.ts`, treats this specially and never as a
 *    draw). A genuinely mid-game Bo3 that both players started but didn't
 *    finish in time collapses into the same double-loss outcome — the
 *    deadline is a hard cutoff either way, and distinguishing "abandoned"
 *    from "never started" for a two-human pairing is out of scope here.
 *  - **Bot vs bot**: unreachable in practice — `openRound` decides every
 *    bot-vs-bot pairing the moment the round opens, so one can never reach
 *    the deadline still undecided. Left untouched defensively. */
export function resolveExpiredRound(input: {
    rounds: readonly LimitedRound[];
    roundNumber: number;
    seats: readonly RoundSeatLookup[];
    matchFormat: LimitedMatchFormat;
    now: number;
}): LimitedRound[] {
    const { rounds, roundNumber, seats, matchFormat, now } = input;
    const botSeats = new Set(
        seats.filter(isBotSeat).map((seat) => seat.seatIndex)
    );
    const winGames = gamesToWinMatch(matchFormat);

    return rounds.map((round) => {
        if (round.roundNumber !== roundNumber) return round;
        if (round.deadlineAt === undefined) return round;
        if (round.deadlineAt > now) return round;
        if (isRoundComplete(round)) return round;

        const pairings = round.pairings.map((pairing) => {
            if (pairing.result !== undefined) return pairing;
            if (pairing.seatB === undefined) return pairing; // bye — always already decided; guarded anyway
            const aIsBot = botSeats.has(pairing.seatA);
            const bIsBot = botSeats.has(pairing.seatB);
            if (aIsBot && bIsBot) return pairing; // unreachable — see docstring
            if (aIsBot) {
                return {
                    ...pairing,
                    result: {
                        winsA: winGames,
                        winsB: 0,
                        source: "timeout" as const,
                    },
                };
            }
            if (bIsBot) {
                return {
                    ...pairing,
                    result: {
                        winsA: 0,
                        winsB: winGames,
                        source: "timeout" as const,
                    },
                };
            }
            return {
                ...pairing,
                result: { winsA: 0, winsB: 0, source: "timeout" as const },
            };
        });
        return { ...round, pairings };
    });
}

export interface AdvanceRoundInput {
    eventId: string;
    seats: readonly RoundSeatLookup[];
    /** Every round opened so far, in order. The LAST one is the round the
     *  caller just recorded a result into (or the round `openRound` just
     *  opened, for the round-1 call site) — this function only ever reads
     *  its identity, never mutates a pairing's own result. */
    rounds: readonly LimitedRound[];
    matchFormat: LimitedMatchFormat;
    /** Epoch ms every newly-opened round starts at — injected, same
     *  discipline as `OpenRoundInput.startedAt`. */
    now: number;
    roundDeadlineMinutes?: number;
    seatStrength: ResolveSeatStrength;
}

export type AdvanceRoundResult =
    /** The latest round isn't complete yet — someone else's pairing (or the
     *  caller's own) is still pending. Nothing to write. */
    | { kind: "unchanged" }
    /** One or more further rounds were opened — the last of `rounds` is now
     *  `currentRound` and still has at least one undecided pairing (or the
     *  event has more rounds than `openRound` alone could resolve). */
    | { kind: "roundOpened"; rounds: LimitedRound[]; currentRound: number }
    /** The event's LAST round is now fully decided — every round through it
     *  is in `rounds`, `currentRound` names it, and the caller should flip
     *  the event to `"finished"`. */
    | { kind: "eventFinished"; rounds: LimitedRound[]; currentRound: number };

/** Advances the event's round state once its LATEST round is fully decided
 *  (issue #1646, PRD #1628 stories 20/39-40, ADR 0076): opens the next round —
 *  pairing it against the standings so far and immediately deciding every
 *  bot-vs-bot pairing it comes back with (`openRound` already does this on
 *  EVERY round it opens, round 1 included) — and, if THAT round is ALSO
 *  instantly complete (no human pairing anywhere in it: an all-bot table, or
 *  every human seat happening to hold a bye), cascades straight into the one
 *  after, and so on, until either a round is left with an undecided pairing or
 *  the event's LAST round (`roundsForSeatCount(seats.length)`) is reached —
 *  which returns `"eventFinished"` instead of opening a round N+1 that would
 *  never exist.
 *
 *  Pure — no DB, no clock beyond the injected `now`, no RNG stream that isn't
 *  derived from `(eventId, roundNumber)` (`openRound`'s own determinism
 *  guarantee covers every round this opens, so re-running this over the same
 *  `rounds` reproduces byte-identical further rounds). `"unchanged"` is
 *  returned both when the latest round genuinely isn't complete AND when
 *  `rounds` is empty — this function makes no DB call and asserts no
 *  ownership of "when" it runs; the caller
 *  (`convex/limitedEvents.ts`'s `cascadeEventRounds`) is what makes calling it
 *  after every recorded result — including two callers racing on the same
 *  event — safe: it is a pure, idempotent, re-runnable DECISION, never a
 *  mutation. */
export function advanceRoundIfComplete(
    input: AdvanceRoundInput
): AdvanceRoundResult {
    const {
        eventId,
        seats,
        matchFormat,
        now,
        roundDeadlineMinutes,
        seatStrength,
    } = input;

    let rounds = [...input.rounds];
    const latest = rounds[rounds.length - 1];
    if (!latest || !isRoundComplete(latest)) {
        return { kind: "unchanged" };
    }

    const totalRounds = roundsForSeatCount(seats.length);
    let currentRoundNumber = latest.roundNumber;
    let opened = false;

    while (
        currentRoundNumber < totalRounds &&
        isRoundComplete(rounds[rounds.length - 1])
    ) {
        const nextRoundNumber = currentRoundNumber + 1;
        const nextRound = openRound({
            eventId,
            roundNumber: nextRoundNumber,
            seats,
            previousRounds: rounds,
            matchFormat,
            startedAt: now,
            roundDeadlineMinutes,
            seatStrength,
        });
        rounds = [...rounds, nextRound];
        currentRoundNumber = nextRoundNumber;
        opened = true;
    }

    if (
        currentRoundNumber >= totalRounds &&
        isRoundComplete(rounds[rounds.length - 1])
    ) {
        return {
            kind: "eventFinished",
            rounds,
            currentRound: currentRoundNumber,
        };
    }
    if (opened) {
        return {
            kind: "roundOpened",
            rounds,
            currentRound: currentRoundNumber,
        };
    }
    return { kind: "unchanged" };
}
