// Round state (PRD #1628, ADR 0076, issue #1644). Asserts what a player can
// observe about a freshly opened round — who they're paired against, which
// pairings are already decided, and that reopening the same round can never
// rewrite one — never the shape of an intermediate.
import { describe, expect, it } from "vitest";
import {
    advanceRoundIfComplete,
    findSeatPairing,
    isRoundComplete,
    openRound,
    resolveExpiredRound,
    roundPairingSeed,
    type AdvanceRoundInput,
    type OpenRoundInput,
    type ResolvePairingPresence,
    type RoundSeatLookup,
} from "../rounds";
import type { DeckStrength } from "../matchSim";
import type { LimitedRound } from "../eventTypes";

const EVENT_ID = "limited-event-1644";

function botTable(seatCount: number): RoundSeatLookup[] {
    return Array.from({ length: seatCount }, (_, seatIndex) => ({
        seatIndex,
        isBot: true,
    }));
}

/** A table of `seatCount` seats where seat 0 is the only human — issue #1644's
 *  headline case (1 human + 7 bots). */
function oneHumanTable(seatCount: number): RoundSeatLookup[] {
    return botTable(seatCount).map((seat) =>
        seat.seatIndex === 0 ? { seatIndex: 0 } : seat
    );
}

/** Deck strengths that rise with the seat index, so a simulated pairing has a
 *  real favourite rather than a coin flip. */
const strengthBySeat: (seatIndex: number) => DeckStrength = (seatIndex) => ({
    mean: 2 + seatIndex * 0.2,
});

/** No pairing in these tests has a bound Match to look up presence for
 *  (`matchId` is never set below) unless a test constructs one explicitly, so
 *  this is the shared no-op resolver for every OTHER test — it should never
 *  actually be called. */
const noPresence: ResolvePairingPresence = () => new Set<number>();

/** A `ResolvePairingPresence` reporting exactly `seatIndexes` as present for
 *  ANY matchId — issue #1647 review finding 1's "opponent absent" / "both
 *  present" scenarios. */
function presentSeats(...seatIndexes: number[]): ResolvePairingPresence {
    const present = new Set(seatIndexes);
    return () => present;
}

function open(overrides: Partial<OpenRoundInput> = {}): LimitedRound {
    return openRound({
        eventId: EVENT_ID,
        roundNumber: 1,
        seats: botTable(8),
        previousRounds: [],
        matchFormat: "bo3",
        startedAt: 1_000_000,
        seatStrength: strengthBySeat,
        ...overrides,
    });
}

describe("openRound — pairing (issue #1644 AC 1)", () => {
    it("gives an even table exactly one pairing slot per seat", () => {
        const round = open({ seats: botTable(8) });

        expect(round.pairings).toHaveLength(4);
        const seatsPaired = round.pairings.flatMap((pairing) =>
            pairing.seatB === undefined
                ? [pairing.seatA]
                : [pairing.seatA, pairing.seatB]
        );
        expect([...seatsPaired].sort((a, b) => a - b)).toEqual([
            0, 1, 2, 3, 4, 5, 6, 7,
        ]);
    });

    it("carries the round number and start time through", () => {
        const round = open({ roundNumber: 2, startedAt: 42 });

        expect(round.roundNumber).toBe(2);
        expect(round.startedAt).toBe(42);
    });

    it("sets a deadline only when the event configured one", () => {
        expect(open().deadlineAt).toBeUndefined();
        expect(open({ roundDeadlineMinutes: 50, startedAt: 1000 }).deadlineAt)
            // 50 minutes after the round started.
            .toBe(1000 + 50 * 60_000);
    });

    it("pairs an odd table with exactly one bye", () => {
        const round = open({ seats: botTable(7) });

        const byes = round.pairings.filter(
            (pairing) => pairing.seatB === undefined
        );
        expect(byes).toHaveLength(1);
        expect(round.pairings).toHaveLength(4);
    });
});

describe("openRound — bot-vs-bot pairings decide immediately (AC 2)", () => {
    it("decides every pairing of an all-bot table, marked simulated", () => {
        const round = open({ seats: botTable(8) });

        expect(isRoundComplete(round)).toBe(true);
        for (const pairing of round.pairings) {
            expect(pairing.result?.source).toBe("simulated");
        }
    });

    it("records a Bo3 bot match as 2-0, 2-1, 1-2 or 0-2", () => {
        const round = open({ seats: botTable(8), matchFormat: "bo3" });

        for (const pairing of round.pairings) {
            const { winsA, winsB } = pairing.result!;
            expect(Math.max(winsA, winsB)).toBe(2);
            expect(Math.min(winsA, winsB)).toBeLessThanOrEqual(1);
        }
    });

    it("records a Bo1 bot match as a single game", () => {
        const round = open({ seats: botTable(8), matchFormat: "bo1" });

        for (const pairing of round.pairings) {
            const { winsA, winsB } = pairing.result!;
            expect(winsA + winsB).toBe(1);
        }
    });

    it("never asks a human seat for a deck strength", () => {
        const asked: number[] = [];
        const round = open({
            seats: oneHumanTable(8),
            seatStrength: (seatIndex) => {
                asked.push(seatIndex);
                return strengthBySeat(seatIndex);
            },
        });

        expect(asked).not.toContain(0);
        expect(round.pairings).toHaveLength(4);
    });
});

describe("openRound — byes (AC 3)", () => {
    it("records a bye as a match win worth the format's games", () => {
        const bo3 = open({ seats: botTable(7), matchFormat: "bo3" });
        const bo3Bye = bo3.pairings.find(
            (pairing) => pairing.seatB === undefined
        )!;
        expect(bo3Bye.result).toEqual({ winsA: 2, winsB: 0, source: "bye" });

        const bo1 = open({ seats: botTable(7), matchFormat: "bo1" });
        const bo1Bye = bo1.pairings.find(
            (pairing) => pairing.seatB === undefined
        )!;
        expect(bo1Bye.result).toEqual({ winsA: 1, winsB: 0, source: "bye" });
    });

    it("never hands the same seat two byes across an event", () => {
        const seats = botTable(7);
        const rounds: LimitedRound[] = [];
        const byeSeats: number[] = [];
        for (let roundNumber = 1; roundNumber <= 3; roundNumber++) {
            const round = open({
                seats,
                roundNumber,
                previousRounds: [...rounds],
            });
            rounds.push(round);
            byeSeats.push(
                round.pairings.find((pairing) => pairing.seatB === undefined)!
                    .seatA
            );
        }

        expect(new Set(byeSeats).size).toBe(3);
    });
});

describe("openRound — determinism (AC 4)", () => {
    it("reopening the same round reproduces byte-identical pairings and results", () => {
        const first = open({ seats: botTable(8) });
        const second = open({ seats: botTable(8) });

        expect(second).toEqual(first);
    });

    it("gives a different event a different round, same seats", () => {
        const a = open({ seats: botTable(8) });
        const b = open({ seats: botTable(8), eventId: "some-other-event" });

        // Seeded from the event id, so the two are independent draws — they
        // must not be the same object graph. (A collision on 8 seats is
        // possible in principle; this pair is checked in, so it either passes
        // forever or not at all.)
        expect(b).not.toEqual(a);
    });

    it("derives its pairing seed from the event id and round number", () => {
        expect(roundPairingSeed(EVENT_ID, 1)).toBe(
            roundPairingSeed(EVENT_ID, 1)
        );
        expect(roundPairingSeed(EVENT_ID, 1)).not.toBe(
            roundPairingSeed(EVENT_ID, 2)
        );
        expect(roundPairingSeed(EVENT_ID, 1)).not.toBe(
            roundPairingSeed("other", 1)
        );
    });
});

describe("openRound — a table of 1 human + 7 bots (AC 7)", () => {
    const round = open({ seats: oneHumanTable(8) });
    const humanPairing = findSeatPairing(round, 0)!;

    it("leaves the human's pairing pending", () => {
        expect(humanPairing.result).toBeUndefined();
    });

    it("decides every OTHER pairing", () => {
        const others = round.pairings.filter(
            (pairing) => pairing !== humanPairing
        );
        expect(others).toHaveLength(3);
        for (const pairing of others) {
            expect(pairing.result?.source).toBe("simulated");
        }
    });

    it("leaves the round itself incomplete until the human plays", () => {
        expect(isRoundComplete(round)).toBe(false);
    });

    it("pairs the human against a bot seat, never against nobody", () => {
        expect(humanPairing.seatB).toBeDefined();
        expect(humanPairing.seatA === 0 || humanPairing.seatB === 0).toBe(true);
    });
});

describe("openRound — human-vs-human pairings stay undecided", () => {
    it("never simulates a pairing with a human on either side", () => {
        const seats: RoundSeatLookup[] = [
            { seatIndex: 0 },
            { seatIndex: 1 },
            { seatIndex: 2, isBot: true },
            { seatIndex: 3, isBot: true },
        ];
        const round = open({ seats });

        for (const pairing of round.pairings) {
            const involvesHuman =
                pairing.seatA < 2 ||
                (pairing.seatB !== undefined && pairing.seatB < 2);
            expect(pairing.result === undefined).toBe(involvesHuman);
        }
    });

    it("treats a seat with neither userId nor isBot as human (never simulated)", () => {
        const round = open({
            seats: [
                { seatIndex: 0 },
                { seatIndex: 1 },
                { seatIndex: 2 },
                { seatIndex: 3 },
            ],
        });

        expect(isRoundComplete(round)).toBe(false);
        expect(
            round.pairings.every((pairing) => pairing.result === undefined)
        ).toBe(true);
    });
});

describe("openRound — later rounds", () => {
    it("pairs round 2 against round 1's results without repeating a matchup", () => {
        const seats = botTable(8);
        const round1 = open({ seats, roundNumber: 1 });
        const round2 = open({
            seats,
            roundNumber: 2,
            previousRounds: [round1],
        });

        const key = (a: number, b: number) =>
            a < b ? `${a}:${b}` : `${b}:${a}`;
        const round1Keys = new Set(
            round1.pairings.map((pairing) => key(pairing.seatA, pairing.seatB!))
        );
        for (const pairing of round2.pairings) {
            expect(round1Keys.has(key(pairing.seatA, pairing.seatB!))).toBe(
                false
            );
        }
    });

    it("refuses to pair against a round that still has an undecided pairing", () => {
        const round1 = open({ seats: oneHumanTable(8), roundNumber: 1 });

        expect(() =>
            open({
                seats: oneHumanTable(8),
                roundNumber: 2,
                previousRounds: [round1],
            })
        ).toThrow(/undecided pairing/);
    });
});

describe("findSeatPairing / isRoundComplete", () => {
    const round: LimitedRound = {
        roundNumber: 1,
        startedAt: 0,
        pairings: [
            { seatA: 0, seatB: 1 },
            { seatA: 2, result: { winsA: 2, winsB: 0, source: "bye" } },
        ],
    };

    it("finds a seat's pairing from either side", () => {
        expect(findSeatPairing(round, 0)?.seatB).toBe(1);
        expect(findSeatPairing(round, 1)?.seatA).toBe(0);
        expect(findSeatPairing(round, 2)?.seatB).toBeUndefined();
    });

    it("returns null for a seat that isn't in the round", () => {
        expect(findSeatPairing(round, 9)).toBeNull();
    });

    it("reports a round with an undecided pairing as incomplete", () => {
        expect(isRoundComplete(round)).toBe(false);
        expect(
            isRoundComplete({
                ...round,
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 1, source: "played" },
                    },
                ],
            })
        ).toBe(true);
    });
});

// ── advanceRoundIfComplete (issue #1646) ────────────────────────────────────

/** Marks seat 0's pairing of `round` as PLAYED — stands in for what
 *  `recordPlayedPairing` (issue #1645) does to a real round when the human's
 *  Match finishes. */
function decideHumanPairing(round: LimitedRound): LimitedRound {
    return {
        ...round,
        pairings: round.pairings.map((pairing) =>
            pairing.seatA === 0 || pairing.seatB === 0
                ? {
                      ...pairing,
                      result: { winsA: 2, winsB: 1, source: "played" as const },
                  }
                : pairing
        ),
    };
}

function advance(overrides: Partial<AdvanceRoundInput> = {}) {
    return advanceRoundIfComplete({
        eventId: EVENT_ID,
        seats: botTable(8),
        rounds: [],
        matchFormat: "bo3",
        now: 2_000_000,
        seatStrength: strengthBySeat,
        ...overrides,
    });
}

describe("advanceRoundIfComplete — no-op cases", () => {
    it("reports unchanged when there are no rounds at all", () => {
        expect(advance({ rounds: [] })).toEqual({ kind: "unchanged" });
    });

    it("reports unchanged while the latest round still has an undecided pairing", () => {
        const seats = oneHumanTable(8);
        const round1 = open({ seats, roundNumber: 1 });

        expect(advance({ seats, rounds: [round1] })).toEqual({
            kind: "unchanged",
        });
    });
});

describe("advanceRoundIfComplete — opens the next round (AC 1)", () => {
    it("opens round 2 once round 1 is fully decided, leaving the human's new pairing pending", () => {
        const seats = oneHumanTable(8);
        const round1 = open({ seats, roundNumber: 1 });
        const decidedRound1 = decideHumanPairing(round1);
        expect(isRoundComplete(decidedRound1)).toBe(true);

        const result = advance({ seats, rounds: [decidedRound1] });

        expect(result.kind).toBe("roundOpened");
        if (result.kind !== "roundOpened") throw new Error("unreachable");
        expect(result.currentRound).toBe(2);
        expect(result.rounds).toHaveLength(2);
        expect(result.rounds[0]).toBe(decidedRound1);
        const round2 = result.rounds[1];
        expect(round2.roundNumber).toBe(2);
        const humanPairing = findSeatPairing(round2, 0)!;
        expect(humanPairing.result).toBeUndefined();
    });

    it("never repairs the human against round 1's opponent", () => {
        const seats = oneHumanTable(8);
        const round1 = open({ seats, roundNumber: 1 });
        const decidedRound1 = decideHumanPairing(round1);
        const round1Opponent = findSeatPairing(decidedRound1, 0)!.seatB;

        const result = advance({ seats, rounds: [decidedRound1] });
        if (result.kind !== "roundOpened")
            throw new Error("expected roundOpened");
        const round2Opponent = findSeatPairing(result.rounds[1], 0)!.seatB;

        expect(round2Opponent).not.toBe(round1Opponent);
    });
});

describe("advanceRoundIfComplete — cascades with no human pairings (AC 2)", () => {
    it("cascades an all-bot table straight through to eventFinished", () => {
        const seats = botTable(8);
        const round1 = open({ seats, roundNumber: 1 });
        // Sanity: `openRound` already decides an all-bot round in full — the
        // premise this cascade exists to act on.
        expect(isRoundComplete(round1)).toBe(true);

        const result = advance({ seats, rounds: [round1] });

        expect(result.kind).toBe("eventFinished");
        if (result.kind !== "eventFinished") throw new Error("unreachable");
        expect(result.rounds).toHaveLength(3); // roundsForSeatCount(8)
        expect(result.currentRound).toBe(3);
        for (const round of result.rounds) {
            expect(isRoundComplete(round)).toBe(true);
        }
    });

    it("never repeats a pairing across the cascaded rounds", () => {
        const seats = botTable(8);
        const round1 = open({ seats, roundNumber: 1 });
        const result = advance({ seats, rounds: [round1] });
        if (result.kind === "unchanged") throw new Error("expected an advance");

        const key = (a: number, b: number) =>
            a < b ? `${a}:${b}` : `${b}:${a}`;
        const seen = new Set<string>();
        for (const round of result.rounds) {
            for (const pairing of round.pairings) {
                if (pairing.seatB === undefined) continue;
                const pairKey = key(pairing.seatA, pairing.seatB);
                expect(seen.has(pairKey)).toBe(false);
                seen.add(pairKey);
            }
        }
    });

    it("reopening the same advance reproduces byte-identical further rounds", () => {
        const seats = botTable(8);
        const round1 = open({ seats, roundNumber: 1 });

        const first = advance({ seats, rounds: [round1] });
        const second = advance({ seats, rounds: [round1] });

        expect(second).toEqual(first);
    });
});

describe("advanceRoundIfComplete — event finish (AC 4)", () => {
    it("finishes the event on the last round's last pairing, without opening round N+1", () => {
        const seats = botTable(8);
        const round1 = open({ seats, roundNumber: 1 });
        const round2 = open({
            seats,
            roundNumber: 2,
            previousRounds: [round1],
        });
        const round3 = open({
            seats,
            roundNumber: 3,
            previousRounds: [round1, round2],
        });

        const result = advance({ seats, rounds: [round1, round2, round3] });

        expect(result.kind).toBe("eventFinished");
        if (result.kind !== "eventFinished") throw new Error("unreachable");
        expect(result.rounds).toHaveLength(3);
        expect(result.currentRound).toBe(3);
    });

    it("leaves a table of 1 human + 7 bots' last round finishing only once the human plays it", () => {
        const seats = oneHumanTable(8);
        const round1 = decideHumanPairing(open({ seats, roundNumber: 1 }));
        const afterRound1 = advance({ seats, rounds: [round1] });
        if (afterRound1.kind !== "roundOpened") {
            throw new Error("expected round 2 to open");
        }
        const round2 = decideHumanPairing(afterRound1.rounds[1]);
        const afterRound2 = advance({ seats, rounds: [round1, round2] });
        if (afterRound2.kind !== "roundOpened") {
            throw new Error("expected round 3 to open");
        }
        expect(afterRound2.currentRound).toBe(3);

        const round3 = afterRound2.rounds[2];
        // Round 3 is the LAST round (roundsForSeatCount(8) === 3) — the
        // human's pairing is still pending, so the event has not finished.
        expect(advance({ seats, rounds: [round1, round2, round3] })).toEqual({
            kind: "unchanged",
        });

        const decidedRound3 = decideHumanPairing(round3);
        const finished = advance({
            seats,
            rounds: [round1, round2, decidedRound3],
        });
        expect(finished.kind).toBe("eventFinished");
        if (finished.kind !== "eventFinished") throw new Error("unreachable");
        expect(finished.currentRound).toBe(3);
    });
});

// ── resolveExpiredRound (issue #1647) ───────────────────────────────────────

describe("resolveExpiredRound — closes an undecided pairing at the deadline", () => {
    it("closes a human-vs-bot pairing 0-2 against the absent human, marked timeout", () => {
        const seats: RoundSeatLookup[] = [
            { seatIndex: 0 }, // human
            { seatIndex: 1, isBot: true },
        ];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1 }],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: noPresence,
        });

        expect(closed.pairings[0].result).toEqual({
            winsA: 0,
            winsB: 2,
            source: "timeout",
        });
    });

    it("closes a bot-vs-human pairing 0-2 against the absent human on the OTHER side", () => {
        const seats: RoundSeatLookup[] = [
            { seatIndex: 0, isBot: true },
            { seatIndex: 1 }, // human
        ];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1 }],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: noPresence,
        });

        expect(closed.pairings[0].result).toEqual({
            winsA: 2,
            winsB: 0,
            source: "timeout",
        });
    });

    it("respects the format's game count (Bo1 is 1-0, not 2-0)", () => {
        const seats: RoundSeatLookup[] = [
            { seatIndex: 0 },
            { seatIndex: 1, isBot: true },
        ];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1 }],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo1",
            now: 1000,
            resolvePresence: noPresence,
        });

        expect(closed.pairings[0].result).toEqual({
            winsA: 0,
            winsB: 1,
            source: "timeout",
        });
    });

    it("closes a human-vs-human pairing as a double loss when neither showed up — no Match was ever bound (PRD story 34)", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1 }], // no matchId — nobody ever started
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: noPresence,
        });

        expect(closed.pairings[0].result).toEqual({
            winsA: 0,
            winsB: 0,
            source: "timeout",
        });
    });

    it("awards the win to the seat who showed up when a Match is bound and the opponent never joined (issue #1647 review finding 1, PRD story 33)", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1, matchId: "match-1" }],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: presentSeats(0), // only seat 0 started it
        });

        expect(closed.pairings[0].result).toEqual({
            winsA: 2,
            winsB: 0,
            source: "timeout",
        });
    });

    it("awards the win to the OTHER seat when the pairing's own seatB is the one who started the Match", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1, matchId: "match-1" }],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: presentSeats(1), // only seat 1 started it
        });

        expect(closed.pairings[0].result).toEqual({
            winsA: 0,
            winsB: 2,
            source: "timeout",
        });
    });

    it("still closes as a double loss when a Match is bound but BOTH seats showed up (a mid-game Bo3 neither finished in time)", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1, matchId: "match-1" }],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: presentSeats(0, 1), // both joined
        });

        expect(closed.pairings[0].result).toEqual({
            winsA: 0,
            winsB: 0,
            source: "timeout",
        });
    });

    it("never rewrites an already-decided pairing", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const decided = {
            seatA: 0,
            seatB: 1,
            result: { winsA: 2, winsB: 1, source: "played" as const },
        };
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [decided],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: noPresence,
        });

        expect(closed.pairings[0]).toBe(decided); // same object — never rewritten
    });

    it("never closes a bye pairing (already decided at round open)", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }];
        const bye = {
            seatA: 0,
            result: { winsA: 2, winsB: 0, source: "bye" as const },
        };
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [bye],
        };

        const [closed] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: noPresence,
        });

        expect(closed.pairings[0]).toBe(bye);
    });

    it("never closes anything when the event has no configured deadline", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            // No `deadlineAt` — story 4: a relaxed table is never cut short.
            pairings: [{ seatA: 0, seatB: 1 }],
        };

        const [unchanged] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 999_999_999,
            resolvePresence: noPresence,
        });

        expect(unchanged).toBe(round);
        expect(unchanged.pairings[0].result).toBeUndefined();
    });

    it("never closes anything before the deadline has actually elapsed", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1 }],
        };

        const [unchanged] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 999, // one ms before the deadline
            resolvePresence: noPresence,
        });

        expect(unchanged.pairings[0].result).toBeUndefined();
    });

    it("is idempotent: re-running on an already-closed round changes nothing (never fires twice)", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1 }],
        };

        const [closedOnce] = resolveExpiredRound({
            rounds: [round],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: noPresence,
        });
        const [closedTwice] = resolveExpiredRound({
            rounds: [closedOnce],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: 2000,
            resolvePresence: noPresence,
        });

        expect(closedTwice).toBe(closedOnce);
    });

    it("only touches the named round — every other round is untouched", () => {
        const seats: RoundSeatLookup[] = [{ seatIndex: 0 }, { seatIndex: 1 }];
        const round1: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            pairings: [
                {
                    seatA: 0,
                    seatB: 1,
                    result: { winsA: 2, winsB: 0, source: "played" },
                },
            ],
        };
        const round2: LimitedRound = {
            roundNumber: 2,
            startedAt: 500,
            deadlineAt: 1000,
            pairings: [{ seatA: 0, seatB: 1 }],
        };

        const [unchangedRound1, closedRound2] = resolveExpiredRound({
            rounds: [round1, round2],
            roundNumber: 2,
            seats,
            matchFormat: "bo3",
            now: 1000,
            resolvePresence: noPresence,
        });

        expect(unchangedRound1).toBe(round1);
        expect(closedRound2.pairings[0].result).toEqual({
            winsA: 0,
            winsB: 0,
            source: "timeout",
        });
    });

    it("feeding the closed round into advanceRoundIfComplete opens the next round, exactly like a played result", () => {
        const seats = oneHumanTable(8);
        const round1 = open({
            seats,
            roundNumber: 1,
            roundDeadlineMinutes: 20,
        });
        expect(isRoundComplete(round1)).toBe(false);

        const [closedRound1] = resolveExpiredRound({
            rounds: [round1],
            roundNumber: 1,
            seats,
            matchFormat: "bo3",
            now: round1.deadlineAt!,
            resolvePresence: noPresence,
        });
        expect(isRoundComplete(closedRound1)).toBe(true);

        const result = advanceRoundIfComplete({
            eventId: EVENT_ID,
            seats,
            rounds: [closedRound1],
            matchFormat: "bo3",
            now: round1.deadlineAt! + 1,
            roundDeadlineMinutes: 20,
            seatStrength: strengthBySeat,
        });

        expect(result.kind).toBe("roundOpened");
        if (result.kind !== "roundOpened") throw new Error("unreachable");
        expect(result.currentRound).toBe(2);
        expect(findSeatPairing(result.rounds[1], 0)!.result).toBeUndefined();
    });
});
