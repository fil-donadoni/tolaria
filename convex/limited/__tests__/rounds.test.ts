// Round state (PRD #1628, ADR 0076, issue #1644). Asserts what a player can
// observe about a freshly opened round — who they're paired against, which
// pairings are already decided, and that reopening the same round can never
// rewrite one — never the shape of an intermediate.
import { describe, expect, it } from "vitest";
import {
    findSeatPairing,
    isRoundComplete,
    openRound,
    roundPairingSeed,
    type OpenRoundInput,
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
