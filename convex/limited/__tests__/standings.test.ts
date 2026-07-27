// Standings tests (PRD #1628 story 22-24/47, issue #1643). Pure unit tests
// against `computeStandings` — hand-built Round fixtures, no database, no
// `convex-test` harness (project convention, mirrors `completion.test.ts`).
import { describe, it, expect } from "vitest";
import { computeStandings, type StandingsRound } from "../standings";

describe("computeStandings — zeroed table (issue #1643 AC)", () => {
    it("is readable — zeroed, not crashed or blank — for an event with no results yet", () => {
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }, { seatIndex: 2 }],
            []
        );
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row.points).toBe(0);
            expect(row.matchWins).toBe(0);
            expect(row.matchLosses).toBe(0);
            expect(row.matchDraws).toBe(0);
            expect(row.gameWins).toBe(0);
            expect(row.gameLosses).toBe(0);
            expect(row.gameWinPct).toBe(0);
            expect(row.opponentMatchWinPct).toBe(0);
        }
        // Deterministic residual order — seatIndex ascending when every key
        // ties.
        expect(rows.map((r) => r.seatIndex)).toEqual([0, 1, 2]);
    });

    it("ignores an undecided pairing (still being played, or waiting on a human)", () => {
        const rounds: StandingsRound[] = [
            { pairings: [{ seatA: 0, seatB: 1 }] },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            rounds
        );
        expect(rows.every((r) => r.points === 0)).toBe(true);
        expect(rows.every((r) => r.matchWins === 0)).toBe(true);
    });
});

describe("computeStandings — points/record/game-record (issue #1643 AC)", () => {
    it("awards 3 points and a match win to the winner of a played match, 0 to the loser", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 1, source: "played" },
                    },
                ],
            },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            rounds
        );
        const winner = rows.find((r) => r.seatIndex === 0)!;
        const loser = rows.find((r) => r.seatIndex === 1)!;
        expect(winner.points).toBe(3);
        expect(winner.matchWins).toBe(1);
        expect(winner.matchLosses).toBe(0);
        expect(winner.gameWins).toBe(2);
        expect(winner.gameLosses).toBe(1);
        expect(loser.points).toBe(0);
        expect(loser.matchLosses).toBe(1);
        expect(loser.gameWins).toBe(1);
        expect(loser.gameLosses).toBe(2);
    });

    it("accumulates points/records/game totals across multiple rounds", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                ],
            },
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 2,
                        result: { winsA: 1, winsB: 2, source: "played" },
                    },
                ],
            },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }, { seatIndex: 2 }],
            rounds
        );
        const seat0 = rows.find((r) => r.seatIndex === 0)!;
        expect(seat0.points).toBe(3); // 1 win, 1 loss
        expect(seat0.matchWins).toBe(1);
        expect(seat0.matchLosses).toBe(1);
        expect(seat0.gameWins).toBe(3); // 2 + 1
        expect(seat0.gameLosses).toBe(2); // 0 + 2
        expect(seat0.gameWinPct).toBeCloseTo(3 / 5);
    });

    it("counts a bye as a match win worth the games it is recorded as (PRD story 27/28)", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    { seatA: 0, result: { winsA: 2, winsB: 0, source: "bye" } },
                ],
            },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            rounds
        );
        const byeSeat = rows.find((r) => r.seatIndex === 0)!;
        expect(byeSeat.points).toBe(3);
        expect(byeSeat.matchWins).toBe(1);
        expect(byeSeat.gameWins).toBe(2);
        expect(byeSeat.gameLosses).toBe(0);
        expect(byeSeat.gameWinPct).toBe(1);
        // The bye has no opponent — the seat sitting out is untouched.
        const other = rows.find((r) => r.seatIndex === 1)!;
        expect(other.points).toBe(0);
        expect(other.matchWins).toBe(0);
    });

    it("counts a single-side timeout as a straightforward 0-2 loss for the absent side (issue AC)", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 0, winsB: 2, source: "timeout" },
                    },
                ],
            },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            rounds
        );
        const absent = rows.find((r) => r.seatIndex === 0)!;
        const present = rows.find((r) => r.seatIndex === 1)!;
        expect(absent.points).toBe(0);
        expect(absent.matchLosses).toBe(1);
        expect(absent.matchDraws).toBe(0);
        expect(present.points).toBe(3);
        expect(present.matchWins).toBe(1);
    });

    it("counts a double no-show timeout as a loss for BOTH sides, not a draw (PRD story 34)", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 0, winsB: 0, source: "timeout" },
                    },
                ],
            },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            rounds
        );
        for (const row of rows) {
            expect(row.points).toBe(0);
            expect(row.matchLosses).toBe(1);
            expect(row.matchDraws).toBe(0);
            expect(row.matchWins).toBe(0);
        }
    });

    it("records a genuine draw (equal wins, non-timeout source) as 1 point each", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 1, winsB: 1, source: "played" },
                    },
                ],
            },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            rounds
        );
        for (const row of rows) {
            expect(row.points).toBe(1);
            expect(row.matchDraws).toBe(1);
            expect(row.matchWins).toBe(0);
            expect(row.matchLosses).toBe(0);
            expect(row.gameWinPct).toBe(0.5);
        }
    });
});

describe("computeStandings — opponent match-win % (PRD story 23/47)", () => {
    it("averages, over every real opponent faced, that opponent's own match-win percentage", () => {
        // Seat 0 beats seat 1 in round 1. Seat 1 then goes on to win its
        // round-2 match against seat 2, finishing 1 win / 1 loss —
        // matchWinPct = 3 / (2*3) = 0.5. Seat 0 faced only seat 1, so its
        // OMW% is exactly seat 1's final match-win pct.
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                ],
            },
            {
                pairings: [
                    {
                        seatA: 1,
                        seatB: 2,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                ],
            },
        ];
        const rows = computeStandings(
            [{ seatIndex: 0 }, { seatIndex: 1 }, { seatIndex: 2 }],
            rounds
        );
        const seat0 = rows.find((r) => r.seatIndex === 0)!;
        expect(seat0.opponentMatchWinPct).toBeCloseTo(0.5);
    });

    it("excludes byes from opponent match-win % (a bye has no opponent)", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    { seatA: 0, result: { winsA: 2, winsB: 0, source: "bye" } },
                ],
            },
        ];
        const rows = computeStandings([{ seatIndex: 0 }], rounds);
        expect(rows[0].opponentMatchWinPct).toBe(0);
    });
});

describe("computeStandings — sort order (issue #1643 AC: points, then GW%, then OMW%)", () => {
    it("breaks a three-way points tie first by game-win %, then by opponent match-win %", () => {
        // Seats: A=0, B=1, C=2 all end round 1 with a match win (3 points
        // each) — a three-way points tie.
        //   A beats Z 2-0  -> A's GW% = 2/2 = 100%
        //   B beats Y 2-0  -> B's GW% = 2/2 = 100%
        //   C beats X 2-1  -> C's GW% = 2/3 = 66.7%  (breaks C out via GW%)
        // Round 2 gives Z (not Y) a bye, so their own match-win percentages
        // diverge without introducing a competing perfect record — a bye has
        // no opponent, so it can't itself become a new top-3 contender:
        //   Z's bye -> Z finishes 1 loss/1 (bye) win -> matchWinPct = 0.5
        //   Y plays no round 2 -> Y stays 0-1 -> matchWinPct = 0
        // A's only opponent was Z (OMW% = 0.5); B's only opponent was Y
        // (OMW% = 0) — so A must rank above B, both above C, which is still
        // tied with neither on GW%.
        const A = 0,
            B = 1,
            C = 2,
            X = 3,
            Y = 4,
            Z = 5;
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: A,
                        seatB: Z,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                    {
                        seatA: B,
                        seatB: Y,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                    {
                        seatA: C,
                        seatB: X,
                        result: { winsA: 2, winsB: 1, source: "played" },
                    },
                ],
            },
            {
                pairings: [
                    {
                        seatA: Z,
                        result: { winsA: 2, winsB: 0, source: "bye" },
                    },
                ],
            },
        ];
        const seats = [A, B, C, X, Y, Z].map((seatIndex) => ({
            seatIndex,
        }));
        const rows = computeStandings(seats, rounds);

        const top3 = rows.slice(0, 3).map((r) => r.seatIndex);
        expect(top3).toEqual([A, B, C]);

        const rowA = rows.find((r) => r.seatIndex === A)!;
        const rowB = rows.find((r) => r.seatIndex === B)!;
        const rowC = rows.find((r) => r.seatIndex === C)!;
        expect(rowA.points).toBe(3);
        expect(rowB.points).toBe(3);
        expect(rowC.points).toBe(3);
        expect(rowA.gameWinPct).toBe(1);
        expect(rowB.gameWinPct).toBe(1);
        expect(rowC.gameWinPct).toBeCloseTo(2 / 3);
        expect(rowA.opponentMatchWinPct).toBeCloseTo(0.5);
        expect(rowB.opponentMatchWinPct).toBe(0);
    });

    it("sorts strictly by points first, regardless of game-win %", () => {
        const rounds: StandingsRound[] = [
            {
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 1, source: "played" },
                    },
                    // Seat 2 gets a 1-point draw with seat 3; nowhere near
                    // seat 0's 3 points, even though seat 3 alone has a
                    // higher single-pairing GW% snapshot than seat 1.
                    {
                        seatA: 2,
                        seatB: 3,
                        result: { winsA: 1, winsB: 1, source: "played" },
                    },
                ],
            },
        ];
        const rows = computeStandings(
            [
                { seatIndex: 0 },
                { seatIndex: 1 },
                { seatIndex: 2 },
                { seatIndex: 3 },
            ],
            rounds
        );
        expect(rows[0].seatIndex).toBe(0); // 3 points, sole leader
    });
});
