// Swiss pairing engine (PRD #1628, issue #1641) — a PURE function of Seats and
// the Rounds already played: given the event's Seats and its prior Rounds,
// produce the next Round's pairings. No DB access, no Convex context — the
// mutations that consume this (opening a Round, recording a result) land in a
// later ticket (`convex/limitedEvents.ts`, `limited/rounds.ts`).
//
// Mirrors the pure-module discipline `eventLogic.ts` already established:
// every non-trivial decision is a plain function of plain data, unit-testable
// without a database. RNG is injected exactly like `draftEngine.ts`'s pack
// generation (`gre/rng.ts`'s `makeRng`), so pairings are reproducible given a
// seed (PRD stories 19/49) without this module touching a `GameState`.

import { MAX_SEATS, MIN_SEATS } from "./eventLogic";
import { shuffleWithRng } from "../gre/rng";
import { classifyPairingResult } from "./standings";

/** How a Pairing's result came to be decided (PRD #1628 schema). This
 *  module's own scoring only needs to know WHO won (`winsA` vs `winsB`, or
 *  "nobody, it's a bye") — `source` is carried on the type purely so
 *  downstream modules (`rounds.ts`, `standings.ts`, both later tickets) share
 *  one Pairing shape with no re-declaration. */
export type SwissResultSource = "played" | "simulated" | "bye" | "timeout";

/** A decided Pairing's outcome — games won by each side within the Match
 *  (Bo1/Bo3, decided elsewhere). A bye's `winsA`/`winsB` are whatever the
 *  Round-state module records it as "worth" (PRD story 28) — irrelevant to
 *  this module, which always scores a bye as a match win for `seatA`. */
export interface SwissPairingResult {
    winsA: number;
    winsB: number;
    source: SwissResultSource;
}

/** One Pairing within a Round. `seatB` absent means `seatA` holds the
 *  Round's bye (PRD stories 27/28) — never a real opponent, never subject to
 *  the no-repeat check. `result` is present on a `previousRounds` Pairing
 *  `pairRound` is asked to pair against (it must already be decided) and
 *  absent on the freshly produced pairings this module returns — recording a
 *  result is the caller's job, not this module's. */
export interface SwissPairing {
    seatA: number;
    seatB?: number;
    result?: SwissPairingResult;
}

/** One already-decided Round: just its Pairings. `pairRound` doesn't need a
 *  round number, a start time or a deadline to do its job — that bookkeeping
 *  belongs entirely to the caller; `previousRounds`'s own array order already
 *  conveys "round 1 first, round 2 second, …". */
export interface SwissRound {
    pairings: SwissPairing[];
}

/** Round count follows table size (PRD story 29) — `ceil(log2(seatCount))`:
 *  4 seats -> 2 rounds, 6-8 seats -> 3. Computed by doubling a capacity
 *  counter rather than `Math.log2`, to sidestep float precision right at the
 *  seat-count boundaries this project actually supports
 *  (`eventLogic.ts`'s `MIN_SEATS`/`MAX_SEATS`, 2-8). */
export function roundsForSeatCount(seatCount: number): number {
    if (
        !Number.isInteger(seatCount) ||
        seatCount < MIN_SEATS ||
        seatCount > MAX_SEATS
    ) {
        throw new Error(
            `roundsForSeatCount: seatCount must be an integer between ${MIN_SEATS} and ${MAX_SEATS} (got ${seatCount})`
        );
    }
    let rounds = 0;
    let capacity = 1;
    while (capacity < seatCount) {
        capacity *= 2;
        rounds++;
    }
    return rounds;
}

function pairKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Every seat pair that has already faced each other, and every seat that has
 *  already drawn a bye, across `previousRounds` (PRD stories 27/30 — no
 *  repeat pairing, at most one bye per seat per event). Throws if a prior
 *  Pairing has no `result` yet: `pairRound` must only ever be asked to pair
 *  the round AFTER every earlier round is fully decided — an undecided prior
 *  Pairing means the caller invoked this too early. */
function collectHistory(previousRounds: readonly SwissRound[]): {
    played: Set<string>;
    byeSeats: Set<number>;
} {
    const played = new Set<string>();
    const byeSeats = new Set<number>();
    for (const round of previousRounds) {
        for (const pairing of round.pairings) {
            if (!pairing.result) {
                throw new Error(
                    "pairRound: previousRounds contains an undecided pairing"
                );
            }
            if (pairing.seatB === undefined) {
                byeSeats.add(pairing.seatA);
            } else {
                played.add(pairKey(pairing.seatA, pairing.seatB));
            }
        }
    }
    return { played, byeSeats };
}

function bump(scores: Map<number, number>, seat: number, amount: number): void {
    scores.set(seat, (scores.get(seat) ?? 0) + amount);
}

/** Each seat's running score across `previousRounds` — a win (or a bye) is
 *  worth 1, a draw 0.5, a loss 0 (a `"timeout"` double no-show — PRD story
 *  34 — is a loss for both sides, not a draw). Used ONLY to rank seats into
 *  brackets for THIS round's pairing; the public standings point scale
 *  (3/1/0, `standings.ts`) doesn't need to agree numerically with this, only
 *  ORDINALLY — win > draw > loss either way.
 *
 *  The win/draw/doubleLoss call itself is NOT reimplemented here —
 *  `standings.ts`'s `classifyPairingResult` is the single authority both
 *  this function and `standings.ts`'s own `recordPairing` call, so a
 *  same-source pairing (e.g. an equal-wins `"timeout"`) can never be scored
 *  a draw on the bracket scale while the public standings table scores the
 *  identical pairing a double loss (the disagreement a PR review caught:
 *  before this, `computeScores` folded EVERY equal-wins pairing into the
 *  0.5/0.5 draw branch regardless of `source`). */
export function computeScores(
    seats: readonly number[],
    previousRounds: readonly SwissRound[]
): Map<number, number> {
    const scores = new Map<number, number>(seats.map((seat) => [seat, 0]));
    for (const round of previousRounds) {
        for (const pairing of round.pairings) {
            // `collectHistory` already validated every pairing has a result.
            if (pairing.seatB === undefined) {
                bump(scores, pairing.seatA, 1);
                continue;
            }
            switch (classifyPairingResult(pairing.result!)) {
                case "winA":
                    bump(scores, pairing.seatA, 1);
                    break;
                case "winB":
                    bump(scores, pairing.seatB, 1);
                    break;
                case "draw":
                    bump(scores, pairing.seatA, 0.5);
                    bump(scores, pairing.seatB, 0.5);
                    break;
                case "doubleLoss":
                    // Neither side scores — both stay at their prior total.
                    break;
            }
        }
    }
    return scores;
}

/** Seats grouped by score into buckets, each bucket internally shuffled by
 *  `rng`, then the buckets concatenated highest-score-first ("desc", the
 *  pairing order — same-score seats stay adjacent, so a same-bracket
 *  opponent is always tried before falling down to the next bracket) or
 *  lowest-score-first ("asc", the bye order — PRD story 27: the lowest-
 *  scoring eligible seat sits out). Ties within one score are broken by the
 *  injected `rng` rather than seat index, so pairing stays reproducible
 *  without hard-coding an arbitrary tiebreak. */
function orderByScore(
    seats: readonly number[],
    scores: ReadonlyMap<number, number>,
    rng: () => number,
    direction: "asc" | "desc"
): number[] {
    const buckets = new Map<number, number[]>();
    for (const seat of seats) {
        const score = scores.get(seat) ?? 0;
        const bucket = buckets.get(score);
        if (bucket) bucket.push(seat);
        else buckets.set(score, [seat]);
    }
    const sortedScores = [...buckets.keys()].sort((a, b) =>
        direction === "desc" ? b - a : a - b
    );
    const ordered: number[] = [];
    for (const score of sortedScores) {
        ordered.push(...shuffleWithRng(buckets.get(score)!, rng));
    }
    return ordered;
}

/** Which seat sits out this round when the seat count is odd (PRD story 27).
 *  Prefers a seat that hasn't already had a bye this event, lowest score
 *  first (standard Swiss practice: the bye goes to whoever is doing worst);
 *  ties broken by `rng`. Falls back to considering every seat, still lowest-
 *  score-first, only if every seat has already had a bye — this should never
 *  happen at the round counts `roundsForSeatCount` produces for the table
 *  sizes this project supports (2-8 seats: at most 3 rounds, and an odd seat
 *  count is always large enough to rotate the bye across that many rounds
 *  without a repeat), kept as a defined fallback rather than an unreachable
 *  throw. */
function pickByeSeat(
    seats: readonly number[],
    scores: ReadonlyMap<number, number>,
    byeSeats: ReadonlySet<number>,
    rng: () => number
): number {
    const eligible = seats.filter((seat) => !byeSeats.has(seat));
    const pool = eligible.length > 0 ? eligible : seats;
    return orderByScore(pool, scores, rng, "asc")[0];
}

/** Total "bracket distance" a matching spends splitting seats away from their
 *  score bracket: Σ|score(a) - score(b)| over every pair in `matching`. Zero
 *  means every pair shares a score (no bracket was split); the higher it
 *  climbs, the further pairs were forced from their own bracket. This is the
 *  quantity `backtrackMatch` minimizes (PRD story 31 — "pairings stay inside
 *  score brackets where the bracket allows it"). */
function matchingDisplacement(
    matching: readonly (readonly [number, number])[],
    scores: ReadonlyMap<number, number>
): number {
    let total = 0;
    for (const [a, b] of matching) {
        total += Math.abs((scores.get(a) ?? 0) - (scores.get(b) ?? 0));
    }
    return total;
}

/** Finds the perfect matching over `pool` (must be even-length) that avoids
 *  every pair already in `played` AND minimizes total bracket displacement
 *  (`matchingDisplacement`) — the matching that keeps as many same-score
 *  pairs together as the no-repeat constraint allows, falling seats down a
 *  bracket only as far as it must (PRD story 31). Enumerates EVERY valid
 *  repeat-free matching via backtracking rather than returning the first one
 *  found: a first-DFS-hit can (and, measurably, ~4-5% of the time does)
 *  accept an early greedy pairing that avoids a repeat but needlessly splits
 *  a bracket that a different matching would have kept intact (issue #1641
 *  PR #1649 review finding 1). `pool` is at most `MAX_SEATS` (8) seats, so
 *  exhaustively enumerating every matching (at most 7!! = 105 for 8 seats) is
 *  cheap.
 *
 *  Ties are broken by `pool`'s own order: among matchings tied for the
 *  lowest displacement, the search tries `pool`'s earliest still-available
 *  partner for each seat first and keeps the first minimum it finds (a
 *  strict `<` comparison, so a later equally-good matching never displaces
 *  an earlier one) — the same determinism guarantee the previous
 *  first-DFS-hit approach gave (`orderByScore` is what makes `pool`'s order
 *  itself reproducible from `rng`), now applied as a tiebreak instead of
 *  being the sole criterion.
 *
 *  Returns `null` if no valid full matching exists at all — the caller
 *  surfaces that as an explicit error rather than silently pairing a
 *  repeat. */
function backtrackMatch(
    pool: readonly number[],
    played: ReadonlySet<string>,
    scores: ReadonlyMap<number, number>
): Array<[number, number]> | null {
    let best: Array<[number, number]> | null = null;
    let bestDisplacement = Infinity;

    function search(
        remaining: readonly number[],
        acc: Array<[number, number]>
    ): void {
        if (remaining.length === 0) {
            const displacement = matchingDisplacement(acc, scores);
            if (displacement < bestDisplacement) {
                bestDisplacement = displacement;
                best = [...acc];
            }
            return;
        }
        const [first, ...rest] = remaining;
        for (let i = 0; i < rest.length; i++) {
            const opponent = rest[i];
            if (played.has(pairKey(first, opponent))) continue;
            const nextRemaining = [...rest.slice(0, i), ...rest.slice(i + 1)];
            acc.push([first, opponent]);
            search(nextRemaining, acc);
            acc.pop();
        }
    }

    search(pool, []);
    return best;
}

/** Pairs the next Round (PRD stories 29-31, 48): Swiss pairing over `seats`,
 *  informed by every Pairing already decided in `previousRounds`.
 *
 *  - Never repeats a pairing across the event (story 30).
 *  - Awards a bye to exactly one seat when `seats.length` is odd, never the
 *    same seat twice in the event (story 27).
 *  - Pairs within score brackets where the bracket allows it, falling down a
 *    bracket only when it must to avoid a repeat (story 31) — see
 *    `orderByScore` for how the fall-down ordering is produced and
 *    `backtrackMatch` for how it's realized as an actual no-repeat matching.
 *
 *  `rng` is the project's seeded float stream (`gre/rng.ts`'s `makeRng`) —
 *  the same seed always reproduces the same pairings; a different seed may
 *  not (stories 19/49). */
export function pairRound(
    seats: readonly number[],
    previousRounds: readonly SwissRound[],
    rng: () => number
): SwissPairing[] {
    if (seats.length < MIN_SEATS) {
        throw new Error(
            `pairRound: need at least ${MIN_SEATS} seats to pair a round`
        );
    }
    if (seats.length > MAX_SEATS) {
        throw new Error(
            `pairRound: seats must not exceed ${MAX_SEATS} — backtrackMatch's exhaustive enumeration is only cheap up to this bound`
        );
    }
    if (new Set(seats).size !== seats.length) {
        throw new Error("pairRound: seats must not contain duplicates");
    }

    // Validates every previousRounds pairing is decided before either of the
    // next two calls assumes it (computeScores reads `.result!` unchecked).
    const { played, byeSeats } = collectHistory(previousRounds);
    const scores = computeScores(seats, previousRounds);

    const pairings: SwissPairing[] = [];
    let pool = [...seats];

    if (pool.length % 2 === 1) {
        const byeSeat = pickByeSeat(pool, scores, byeSeats, rng);
        pairings.push({ seatA: byeSeat });
        pool = pool.filter((seat) => seat !== byeSeat);
    }

    const ordered = orderByScore(pool, scores, rng, "desc");
    const matching = backtrackMatch(ordered, played, scores);
    if (!matching) {
        throw new Error(
            "pairRound: no valid pairing exists without repeating a prior matchup"
        );
    }
    for (const [seatA, seatB] of matching) {
        pairings.push({ seatA, seatB });
    }

    return pairings;
}
