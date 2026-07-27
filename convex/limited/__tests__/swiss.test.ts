// Swiss pairing engine tests (PRD #1628, issue #1641). The project has no
// convex-test harness — these exercise the PURE pairing decisions directly,
// exactly like `eventLogic.test.ts` does for `eventLogic.ts`.
import { describe, it, expect } from "vitest";
import { makeRng } from "../../gre/rng";
import {
    pairRound,
    roundsForSeatCount,
    type SwissPairing,
    type SwissRound,
} from "../swiss";

/** Normalizes a Pairing's two seats into a sorted tuple so a test can assert
 *  "these two seats faced each other" without caring which one landed in
 *  `seatA` vs `seatB` (shuffle-order dependent, not a behavior the module
 *  promises). */
function normalizedPair(pairing: SwissPairing): [number, number] {
    if (pairing.seatB === undefined) {
        throw new Error("normalizedPair: pairing is a bye, has no seatB");
    }
    return pairing.seatA < pairing.seatB
        ? [pairing.seatA, pairing.seatB]
        : [pairing.seatB, pairing.seatA];
}

/** Builds a decided `SwissRound` from a list of `[seatA, seatB, winnerSeat]`
 *  triples (a 2-0 match win for `winnerSeat`, `source: "simulated"` — the
 *  content doesn't matter to `pairRound`, only who won). `winnerSeat` may
 *  also be the literal `"draw"` for a 1-1 split (half a point each) — needed
 *  to fabricate the fractional scores the bracket-displacement fixtures
 *  below rely on. */
function decidedRound(
    results: Array<
        [seatA: number, seatB: number, winnerSeat: number | "draw"]
    >
): SwissRound {
    return {
        pairings: results.map(([seatA, seatB, winnerSeat]) => ({
            seatA,
            seatB,
            result:
                winnerSeat === "draw"
                    ? { winsA: 1, winsB: 1, source: "simulated" as const }
                    : winnerSeat === seatA
                      ? { winsA: 2, winsB: 0, source: "simulated" as const }
                      : { winsA: 0, winsB: 2, source: "simulated" as const },
        })),
    };
}

/** A decided bye round: `byeSeat` gets the bye, everyone else in `results`. */
function decidedRoundWithBye(
    byeSeat: number,
    results: Array<[seatA: number, seatB: number, winnerSeat: number]>
): SwissRound {
    const round = decidedRound(results);
    round.pairings.push({
        seatA: byeSeat,
        result: { winsA: 2, winsB: 0, source: "bye" },
    });
    return round;
}

describe("roundsForSeatCount (PRD #1628 story 29)", () => {
    it.each([
        [2, 1],
        [3, 2],
        [4, 2],
        [5, 3],
        [6, 3],
        [7, 3],
        [8, 3],
    ])("seatCount %i -> %i rounds", (seatCount, expected) => {
        expect(roundsForSeatCount(seatCount)).toBe(expected);
    });

    it("rejects a seatCount below the minimum", () => {
        expect(() => roundsForSeatCount(1)).toThrow(/between 2 and 8/);
    });

    it("rejects a seatCount above the maximum", () => {
        expect(() => roundsForSeatCount(9)).toThrow(/between 2 and 8/);
    });

    it("rejects a non-integer seatCount", () => {
        expect(() => roundsForSeatCount(4.5)).toThrow();
    });
});

describe("pairRound — basic shape", () => {
    it("pairs every seat exactly once when the seat count is even", () => {
        const seats = [0, 1, 2, 3];
        const pairings = pairRound(seats, [], makeRng(1));
        expect(pairings).toHaveLength(2);
        const involved = pairings.flatMap((p) =>
            p.seatB === undefined ? [p.seatA] : [p.seatA, p.seatB]
        );
        expect(involved.slice().sort((a, b) => a - b)).toEqual(seats);
    });

    it("awards exactly one bye when the seat count is odd", () => {
        const seats = [0, 1, 2];
        const pairings = pairRound(seats, [], makeRng(1));
        const byes = pairings.filter((p) => p.seatB === undefined);
        expect(byes).toHaveLength(1);
        // 2 real pairings + ... no: 3 seats, one bye, one pairing of 2.
        const matches = pairings.filter((p) => p.seatB !== undefined);
        expect(matches).toHaveLength(1);
    });

    it("does not mutate the input seats array (pure)", () => {
        const seats = [0, 1, 2, 3];
        const snapshot = [...seats];
        pairRound(seats, [], makeRng(1));
        expect(seats).toEqual(snapshot);
    });

    it("rejects fewer than 2 seats", () => {
        expect(() => pairRound([0], [], makeRng(1))).toThrow(
            /at least 2 seats/
        );
    });

    it("rejects duplicate seats", () => {
        expect(() => pairRound([0, 1, 1], [], makeRng(1))).toThrow(
            /duplicates/
        );
    });

    it("rejects previousRounds with an undecided pairing", () => {
        const undecided: SwissRound = {
            pairings: [{ seatA: 0, seatB: 1 }],
        };
        expect(() =>
            pairRound([0, 1, 2, 3], [undecided], makeRng(1))
        ).toThrow(/undecided pairing/);
    });
});

describe("pairRound — no-repeat pairing across a full event (PRD story 30)", () => {
    it.each([2, 3, 4, 5, 6, 7, 8])(
        "never re-pairs two seats across a full %i-seat event",
        (seatCount) => {
            const seats = Array.from({ length: seatCount }, (_, i) => i);
            const rounds = roundsForSeatCount(seatCount);
            const rng = makeRng(20260726 + seatCount);

            const previousRounds: SwissRound[] = [];
            const seenPairs = new Set<string>();
            const byeCounts = new Map<number, number>(
                seats.map((s) => [s, 0])
            );

            for (let round = 0; round < rounds; round++) {
                const pairings = pairRound(seats, previousRounds, rng);

                // Every pairing this round is either a bye or a fresh matchup.
                const roundPairings: SwissRound["pairings"] = [];
                for (const pairing of pairings) {
                    if (pairing.seatB === undefined) {
                        byeCounts.set(
                            pairing.seatA,
                            (byeCounts.get(pairing.seatA) ?? 0) + 1
                        );
                        roundPairings.push({
                            seatA: pairing.seatA,
                            result: { winsA: 2, winsB: 0, source: "bye" },
                        });
                        continue;
                    }
                    const [a, b] = normalizedPair(pairing);
                    const key = `${a}:${b}`;
                    expect(seenPairs.has(key)).toBe(false);
                    seenPairs.add(key);
                    // seatA always "wins" 2-0 — arbitrary, fabricated result.
                    roundPairings.push({
                        seatA: pairing.seatA,
                        seatB: pairing.seatB,
                        result: { winsA: 2, winsB: 0, source: "simulated" },
                    });
                }
                previousRounds.push({ pairings: roundPairings });
            }

            // At most one bye per seat across the whole event (PRD story 27).
            for (const count of byeCounts.values()) {
                expect(count).toBeLessThanOrEqual(1);
            }
            // Exactly one bye per round when the seat count is odd, none when even.
            for (const round of previousRounds) {
                const byesThisRound = round.pairings.filter(
                    (p) => p.seatB === undefined
                );
                expect(byesThisRound).toHaveLength(seatCount % 2 === 1 ? 1 : 0);
            }
        }
    );
});

describe("pairRound — score-bracket pairing (PRD story 31)", () => {
    it("pairs seats within their score bracket when the bracket allows it", () => {
        // Round 1: 0 beats 1, 2 beats 3 -> scores {0:1, 1:0, 2:1, 3:0}.
        // Two clean 2-seat brackets with no cross history: {0,2} and {1,3}.
        // Neither pair has faced each other, so bracket pairing is the only
        // valid outcome regardless of the rng seed/shuffle.
        const round1 = decidedRound([
            [0, 1, 0],
            [2, 3, 2],
        ]);
        for (const seed of [1, 2, 3, 42, 999]) {
            const pairings = pairRound([0, 1, 2, 3], [round1], makeRng(seed));
            const pairs = pairings.map(normalizedPair).sort();
            expect(pairs).toEqual([
                [0, 2],
                [1, 3],
            ]);
        }
    });

    it("falls down a bracket deterministically when the top bracket can't pair internally", () => {
        // Round 1: 0 beats 1, 2 beats 3.
        // Round 2: 0 beats 2, 1 beats 3.
        // Scores entering round 3: {0:2, 1:1, 2:1, 3:0}.
        // Round-3 brackets: {0} alone (top), {1,2} tied, {3} alone (bottom).
        // 0 has already played both 1 and 2 -> its own bracket is empty and
        // the next bracket down is fully exhausted too, so 0 must fall all
        // the way to the bottom bracket and pair with 3 (its only remaining
        // unplayed opponent). 1 and 2 have never played, so they pair each
        // other. This chain is forced by the no-repeat constraint alone —
        // true regardless of shuffle order/seed.
        const round1 = decidedRound([
            [0, 1, 0],
            [2, 3, 2],
        ]);
        const round2 = decidedRound([
            [0, 2, 0],
            [1, 3, 1],
        ]);
        for (const seed of [1, 2, 3, 42, 999]) {
            const pairings = pairRound(
                [0, 1, 2, 3],
                [round1, round2],
                makeRng(seed)
            );
            // seat 0 is always processed first (its score bucket is a
            // singleton), so its pairing is exactly [seatA: 0, seatB: 3].
            const zeroPairing = pairings.find((p) => p.seatA === 0);
            expect(zeroPairing).toEqual({ seatA: 0, seatB: 3 });
            // the other pairing is {1,2} regardless of internal order.
            const other = pairings.find((p) => p.seatA !== 0);
            expect(normalizedPair(other!)).toEqual([1, 2]);
        }
    });

    it("chooses the minimum-bracket-displacement matching, not just the first repeat-free one found (PR #1649 review finding 1)", () => {
        // 6 seats. Round 1: 1 beats 3, 0 beats 2, 4 draws 5.
        // Round 2: 0 draws 5, 1 beats 2, 4 beats 3.
        // Scores entering round 3: {1:2, 0:1.5, 4:1.5, 5:1, 2:0, 3:0}.
        // Played: {1-3, 0-2, 4-5, 0-5, 1-2, 3-4}.
        //
        // `backtrackMatch` used to return the FIRST repeat-free matching it
        // found by DFS over the bracket-ordered pool, with no regard for how
        // much bracket-splitting it cost. Walking the pool in desc-score
        // order [1, {0,4}, 5, {2,3}], the old code paired singleton 1 with
        // whichever of {0,4} it met first (never a repeat, so it never
        // backtracked to look further) -> [1-0, 4-2, 5-3], splitting BOTH the
        // {0,4} bracket (1.5) and the {2,3} bracket (0), total bracket
        // displacement 0.5+1.5+1=3.
        //
        // The fully legal matching [0-4, 1-5, 2-3] keeps both brackets
        // intact and only spends displacement on 1's forced fall to the
        // singleton 5: 0+1+0=1, strictly less. It's provably the UNIQUE
        // minimum (verified by exhaustive enumeration of all 4 valid
        // repeat-free matchings over this pool), so every seed must agree.
        const round1 = decidedRound([
            [1, 3, 1],
            [0, 2, 0],
            [4, 5, "draw"],
        ]);
        const round2 = decidedRound([
            [0, 5, "draw"],
            [1, 2, 1],
            [4, 3, 4],
        ]);
        for (const seed of [1, 2, 3, 42, 999]) {
            const pairings = pairRound(
                [0, 1, 2, 3, 4, 5],
                [round1, round2],
                makeRng(seed)
            );
            const pairs = pairings.map(normalizedPair).sort();
            expect(pairs).toEqual([
                [0, 4],
                [1, 5],
                [2, 3],
            ]);
        }
    });

    it("prefers the bracket-preserving matching when an odd-sized tied bracket has several repeat-free options", () => {
        // 8 seats, 2 previous rounds, engineered so scores land on two ODD
        // (size-3) tied brackets: {0,3,7} at 1.5 and {2,5,6} at 1.0, plus
        // singletons {1} at 0 and {4} at 0.5.
        //
        // Round 1: 0 beats 4, 5 beats 6, 3 beats 1, 7 beats 2.
        // Round 2: 2 beats 5, 0 draws 3, 6 beats 1, 4 draws 7.
        // Scores: {0:1.5, 1:0, 2:1, 3:1.5, 4:0.5, 5:1, 6:1, 7:1.5}.
        //
        // Every one of the 3-way ties {0,3,7} and {2,5,6} has MULTIPLE legal
        // internal pairs (0-3, 0-7, 3-7 are all unplayed; 2-6, 5-... etc are
        // all unplayed too) -- there is no unique forced chain here, unlike
        // the "falls down a bracket" fixture above. Exhaustive enumeration
        // confirms the minimum achievable bracket displacement is 1 (an odd
        // bracket of size 3 can never fully self-pair, so exactly one of its
        // three members must cross into another bracket) and that several
        // distinct matchings tie at that minimum -- this fixture exercises
        // the tie-break, not a forced unique answer.
        //
        // The old first-DFS-hit `backtrackMatch` does NOT find a
        // minimum-displacement matching here: verified empirically, it
        // produces a strictly worse (higher-displacement) matching for every
        // one of the five seeds below.
        const round1 = decidedRound([
            [4, 0, 0],
            [6, 5, 5],
            [1, 3, 3],
            [2, 7, 7],
        ]);
        const round2 = decidedRound([
            [5, 2, 2],
            [0, 3, "draw"],
            [6, 1, 6],
            [4, 7, "draw"],
        ]);
        const scores = new Map<number, number>([
            [0, 1.5],
            [1, 0],
            [2, 1],
            [3, 1.5],
            [4, 0.5],
            [5, 1],
            [6, 1],
            [7, 1.5],
        ]);
        for (const seed of [1, 2, 3, 42, 999]) {
            const pairings = pairRound(
                [0, 1, 2, 3, 4, 5, 6, 7],
                [round1, round2],
                makeRng(seed)
            );
            expect(pairings).toHaveLength(4);
            const displacement = pairings
                .map(normalizedPair)
                .reduce(
                    (total, [a, b]) =>
                        total + Math.abs(scores.get(a)! - scores.get(b)!),
                    0
                );
            // The provable minimum (exhaustive enumeration) — the old
            // first-DFS-hit code overshoots this for every one of these
            // seeds.
            expect(displacement).toBe(1);
            // Bracket {2,5,6} (score 1.0) can only fully self-pair by using
            // 2-6 (5 is the only member of that bracket forced to cross,
            // since 2-5 and 5-6 were both already played) — true at the
            // minimum regardless of which member of {0,3,7} ends up as 5's
            // cross partner.
            const pairs = pairings.map(normalizedPair);
            expect(pairs).toContainEqual([2, 6]);
        }
    });

    it("prefers a seat without a prior bye, lowest score first, for the next bye", () => {
        // 3 seats. Round 1: seat 2 gets the bye, 0 beats 1.
        // Scores entering round 2: {0:1, 1:0, 2:1(bye)}.
        // Seat 1 is the only seat without a prior bye AND the lowest score
        // among the remaining eligible seats (0 and 1 both eligible, but 1
        // has the lower score) -> seat 1 must get round 2's bye.
        const round1 = decidedRoundWithBye(2, [[0, 1, 0]]);
        for (const seed of [1, 2, 3, 42, 999]) {
            const pairings = pairRound([0, 1, 2], [round1], makeRng(seed));
            const bye = pairings.find((p) => p.seatB === undefined);
            expect(bye?.seatA).toBe(1);
        }
    });
});

describe("pairRound — reproducibility (PRD stories 19/49)", () => {
    it("the same seed reproduces identical pairings", () => {
        const seats = [0, 1, 2, 3, 4, 5];
        const run = () => pairRound(seats, [], makeRng(20260726));
        expect(run()).toEqual(run());
    });

    it("a different seed can produce different pairings", () => {
        const seats = [0, 1, 2, 3];
        const results = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) =>
            JSON.stringify(pairRound(seats, [], makeRng(seed)))
        );
        // Not every seed needs to differ from every other, but across ten
        // seeds pairing a 4-seat single bracket (3 possible perfect
        // matchings), we should see more than one distinct outcome.
        expect(new Set(results).size).toBeGreaterThan(1);
    });
});
