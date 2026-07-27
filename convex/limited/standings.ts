// Standings (PRD #1628 story 22-24/47, issue #1643) — the gemello of
// `completion.ts`'s `computeEventCompletion`: a PURE function of the event's
// already-recorded Rounds/Pairings/Results, unit-testable without a database
// and without `convex/limited/swiss.ts` (that module only ever CHOOSES a
// pairing; this one only ever READS a decided one). ADR 0076 / PRD story 47:
// standings are DERIVED at read time, never stored — so the table can never
// disagree with the results it's computed from. This module has no opinion on
// WHEN it's called; `eventProjection.ts`'s `projectLimitedEvent` calls it on
// every read.
//
// Deliberately dependency-free — like `swiss.ts`'s own `SwissPairing`/
// `SwissRound` and `completion.ts`'s own `CompletionSeatLookup` — so this
// module never depends on `Doc<"limitedEvents">` or `eventTypes.ts`'s
// Convex-flavoured shapes. `LimitedRound`/`LimitedPairing`/
// `LimitedPairingResult` (`eventTypes.ts`) are structurally identical to the
// types below, so a caller can pass either straight through.

/** The minimal Seat shape standings needs — just enough to know which seats
 *  exist (so a seat with zero decided pairings still gets a zeroed row,
 *  rather than silently vanishing from the table). */
export interface StandingsSeatLookup {
    seatIndex: number;
}

/** How a Pairing's result came to be decided (PRD #1628 schema, mirrors
 *  `swiss.ts`'s `SwissResultSource` / `eventTypes.ts`'s
 *  `LimitedPairingResultSource`). Only `"timeout"` gets special scoring
 *  treatment here — see `recordPairing` below. */
export type StandingsResultSource = "played" | "simulated" | "bye" | "timeout";

export interface StandingsPairingResult {
    winsA: number;
    winsB: number;
    source: StandingsResultSource;
}

/** One Pairing within a Round. `seatB` absent means `seatA` holds a bye
 *  (PRD stories 27/28 — scored as a match win worth the games recorded on
 *  `result`). `result` absent means the pairing hasn't been decided yet (still
 *  being played, or waiting on a human) — `computeStandings` skips it
 *  entirely, exactly as `swiss.ts`'s `collectHistory` treats an undecided
 *  pairing as "hasn't happened yet" rather than a loss for either side. */
export interface StandingsPairing {
    seatA: number;
    seatB?: number;
    result?: StandingsPairingResult;
}

export interface StandingsRound {
    pairings: StandingsPairing[];
}

/** One seat's row in the standings table (PRD #1628 story 22), sorted by
 *  `computeStandings` per story 23. */
export interface StandingsRow {
    seatIndex: number;
    /** 3 per match win (a bye counts as a win), 1 per match draw, 0 per match
     *  loss (PRD's own point scale — NOT the Magic Tournament Rules' separate
     *  match-point/percentage machinery, which this module doesn't otherwise
     *  reproduce beyond what stories 22-23 ask for). */
    points: number;
    matchWins: number;
    matchLosses: number;
    matchDraws: number;
    gameWins: number;
    gameLosses: number;
    /** Games won / games played across every decided pairing (including
     *  byes). `0` when the seat has played zero games yet — an empty table
     *  must render zeroed, not `NaN` (issue #1643 AC: "readable for an event
     *  with no results yet"). */
    gameWinPct: number;
    /** Average, across every REAL opponent this seat has faced (byes
     *  excluded — a bye has no opponent), of that opponent's OWN match-win
     *  percentage (`points / (matchesPlayed * 3)` — the standard tournament
     *  definition, which folds a draw in as a fractional win rather than
     *  ignoring it). `0` when the seat has faced no real opponent yet. */
    opponentMatchWinPct: number;
}

interface SeatRecord {
    seatIndex: number;
    points: number;
    matchWins: number;
    matchLosses: number;
    matchDraws: number;
    gameWins: number;
    gameLosses: number;
    /** Every REAL opponent this seat has faced, one entry per round (not
     *  deduplicated — the standard tournament OMW% formula averages per round
     *  faced, not per distinct opponent, matching what `pairRound`'s no-repeat
     *  rule makes moot in practice but this module doesn't itself assume). */
    opponents: number[];
}

function emptyRecord(seatIndex: number): SeatRecord {
    return {
        seatIndex,
        points: 0,
        matchWins: 0,
        matchLosses: 0,
        matchDraws: 0,
        gameWins: 0,
        gameLosses: 0,
        opponents: [],
    };
}

function recordWin(record: SeatRecord): void {
    record.matchWins++;
    record.points += 3;
}

function recordLoss(record: SeatRecord): void {
    record.matchLosses++;
}

function recordDraw(record: SeatRecord): void {
    record.matchDraws++;
    record.points += 1;
}

/** Folds one decided Pairing into `records` (mutating both sides' entries in
 *  place — `records` is guaranteed to already hold an entry for every seat
 *  index a Pairing can reference, since `computeStandings` seeds it from the
 *  full seat list before this ever runs).
 *
 *  Scoring:
 *  - A bye (`seatB` absent) is always a match win for `seatA`, worth whatever
 *    games `result` records (PRD story 28) — never a draw/loss regardless of
 *    the recorded `winsA`/`winsB`.
 *  - A `"timeout"` result with equal wins (the double-no-show case, PRD
 *    story 34: "closed as a double loss") scores a LOSS for both sides, not a
 *    draw — the one place `source` changes the scoring, not just the
 *    metadata.
 *  - Every other equal-wins result (e.g. a genuine `"played"` draw — PRD's
 *    own out-of-scope note: "standings support a draw point value, but no
 *    flow deliberately produces one") scores the standard 1-1 draw.
 *  - Otherwise, whichever side has more wins takes the match win. */
function recordPairing(
    records: Map<number, SeatRecord>,
    pairing: StandingsPairing
): void {
    if (!pairing.result) return; // Undecided — hasn't happened yet.
    const { winsA, winsB, source } = pairing.result;
    const a = records.get(pairing.seatA)!;

    if (pairing.seatB === undefined) {
        // Bye: always a match win for seatA, worth its recorded games.
        recordWin(a);
        a.gameWins += winsA;
        a.gameLosses += winsB;
        return;
    }

    const b = records.get(pairing.seatB)!;
    a.gameWins += winsA;
    a.gameLosses += winsB;
    b.gameWins += winsB;
    b.gameLosses += winsA;
    a.opponents.push(pairing.seatB);
    b.opponents.push(pairing.seatA);

    if (winsA === winsB) {
        if (source === "timeout") {
            // Neither side showed up — a double loss (story 34), not a draw:
            // no-shows must never be able to farm points off each other.
            recordLoss(a);
            recordLoss(b);
        } else {
            recordDraw(a);
            recordDraw(b);
        }
        return;
    }

    if (winsA > winsB) {
        recordWin(a);
        recordLoss(b);
    } else {
        recordWin(b);
        recordLoss(a);
    }
}

/** A seat's own match-win percentage — the standard tournament definition,
 *  `points / (matchesPlayed * 3)`, which is what `opponentMatchWinPct` below
 *  averages over each seat's opponents. Folding `points` (rather than a naive
 *  `matchWins / matchesPlayed`) is what makes a draw contribute a fractional
 *  win instead of vanishing from the ratio. `0` for a seat with zero decided
 *  matches — never `NaN`. */
function matchWinPct(record: SeatRecord): number {
    const played = record.matchWins + record.matchLosses + record.matchDraws;
    return played === 0 ? 0 : record.points / (played * 3);
}

/** Computes the standings table (PRD #1628 stories 22-24/47) from `seats` and
 *  every Round decided so far. Pure — no DB access, no Convex context, safe to
 *  call on every projection read (ADR 0076: standings are derived, never
 *  stored).
 *
 *  Sort order (story 23): points desc, then game-win % desc, then opponent
 *  match-win % desc. A residual tie (identical on all three) breaks by
 *  `seatIndex` ascending, purely for a deterministic, reproducible row order —
 *  the sort is otherwise a stable total order over what's actually a
 *  tournament tiebreak scheme, not a further ranking claim. */
export function computeStandings(
    seats: readonly StandingsSeatLookup[],
    rounds: readonly StandingsRound[]
): StandingsRow[] {
    const records = new Map<number, SeatRecord>();
    for (const seat of seats) {
        records.set(seat.seatIndex, emptyRecord(seat.seatIndex));
    }

    for (const round of rounds) {
        for (const pairing of round.pairings) {
            // A pairing can reference a seat not in `seats` (defensive — the
            // event's seat list is the source of truth, but this module
            // doesn't re-validate the caller's Round data) — seed it lazily so
            // `recordPairing`'s `.get(...)!` never throws.
            if (!records.has(pairing.seatA)) {
                records.set(pairing.seatA, emptyRecord(pairing.seatA));
            }
            if (
                pairing.seatB !== undefined &&
                !records.has(pairing.seatB)
            ) {
                records.set(pairing.seatB, emptyRecord(pairing.seatB));
            }
            recordPairing(records, pairing);
        }
    }

    const rows: StandingsRow[] = [...records.values()].map((record) => {
        const gamesPlayed = record.gameWins + record.gameLosses;
        const opponentPct =
            record.opponents.length === 0
                ? 0
                : record.opponents.reduce(
                      (sum, opponentSeat) =>
                          sum + matchWinPct(records.get(opponentSeat)!),
                      0
                  ) / record.opponents.length;
        return {
            seatIndex: record.seatIndex,
            points: record.points,
            matchWins: record.matchWins,
            matchLosses: record.matchLosses,
            matchDraws: record.matchDraws,
            gameWins: record.gameWins,
            gameLosses: record.gameLosses,
            gameWinPct: gamesPlayed === 0 ? 0 : record.gameWins / gamesPlayed,
            opponentMatchWinPct: opponentPct,
        };
    });

    rows.sort((x, y) => {
        if (x.points !== y.points) return y.points - x.points;
        if (x.gameWinPct !== y.gameWinPct) return y.gameWinPct - x.gameWinPct;
        if (x.opponentMatchWinPct !== y.opponentMatchWinPct) {
            return y.opponentMatchWinPct - x.opponentMatchWinPct;
        }
        return x.seatIndex - y.seatIndex;
    });

    return rows;
}
