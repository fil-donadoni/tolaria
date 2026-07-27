// Pairing ↔ Match linkage (PRD #1628, ADR 0076, issue #1645). Pure module, so
// these are plain unit tests over plain data — the DB shell that calls them
// (`startPairingMatch` / `recordLimitedPairingResult`, `convex/game.ts`) is
// driven end to end by `convex/__tests__/limitedPairingMatch.test.ts`.
import { describe, it, expect } from "vitest";
import type { LimitedRound } from "../eventTypes";
import {
    bindPairingMatch,
    recordPlayedPairing,
    resolveStartablePairing,
    unbindPairingMatch,
} from "../pairingMatch";

/** One round with the pairings a 4-seat table produces: 0v1, 2v3. */
function round(overrides: Partial<LimitedRound> = {}): LimitedRound {
    return {
        roundNumber: 1,
        startedAt: 1_000,
        pairings: [
            { seatA: 0, seatB: 1 },
            { seatA: 2, seatB: 3 },
        ],
        ...overrides,
    };
}

describe("resolveStartablePairing (PRD #1628 story 8, issue #1645)", () => {
    it("returns the viewer's pairing and the seat they face, from either side", () => {
        const rounds = [round()];
        expect(resolveStartablePairing(rounds, 1, 0)).toMatchObject({
            opponentSeatIndex: 1,
        });
        expect(resolveStartablePairing(rounds, 1, 1)).toMatchObject({
            opponentSeatIndex: 0,
        });
        expect(resolveStartablePairing(rounds, 1, 3)).toMatchObject({
            opponentSeatIndex: 2,
        });
    });

    it("carries the round the pairing belongs to", () => {
        const r2 = round({ roundNumber: 2 });
        const found = resolveStartablePairing([round(), r2], 2, 0);
        expect(found.round.roundNumber).toBe(2);
    });

    it("rejects a seat with no round in progress", () => {
        expect(() => resolveStartablePairing([round()], undefined, 0)).toThrow(
            /no round in progress/
        );
        // `currentRound` names a round that isn't there.
        expect(() => resolveStartablePairing([round()], 7, 0)).toThrow(
            /no round in progress/
        );
    });

    it("rejects a seat that isn't paired in this round", () => {
        expect(() => resolveStartablePairing([round()], 1, 6)).toThrow(
            /not paired/
        );
    });

    it("rejects a bye — `openRound` already recorded it as a win", () => {
        const rounds = [
            round({
                pairings: [
                    { seatA: 0, result: { winsA: 2, winsB: 0, source: "bye" } },
                ],
            }),
        ];
        expect(() => resolveStartablePairing(rounds, 1, 0)).toThrow(/bye/);
    });

    it("rejects an already-decided pairing", () => {
        const rounds = [
            round({
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 1, source: "played" },
                    },
                ],
            }),
        ];
        expect(() => resolveStartablePairing(rounds, 1, 1)).toThrow(
            /already decided/
        );
    });
});

describe("bindPairingMatch (issue #1645)", () => {
    it("stamps the Match onto the viewer's pairing and nothing else", () => {
        const next = bindPairingMatch([round()], 1, 1, "match-1")!;
        expect(next[0].pairings[0].matchId).toBe("match-1");
        expect(next[0].pairings[1].matchId).toBeUndefined();
    });

    it("does not mutate the input rounds", () => {
        const rounds = [round()];
        bindPairingMatch(rounds, 1, 0, "match-1");
        expect(rounds[0].pairings[0].matchId).toBeUndefined();
    });

    it("declines a pairing that already carries a Match (started once)", () => {
        const bound = bindPairingMatch([round()], 1, 0, "match-1")!;
        expect(bindPairingMatch(bound, 1, 0, "match-2")).toBeNull();
    });

    it("declines a bye, a decided pairing, an unknown round and an unpaired seat", () => {
        const bye = [round({ pairings: [{ seatA: 0 }] })];
        expect(bindPairingMatch(bye, 1, 0, "m")).toBeNull();
        const decided = [
            round({
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 1, winsB: 0, source: "played" },
                    },
                ],
            }),
        ];
        expect(bindPairingMatch(decided, 1, 0, "m")).toBeNull();
        expect(bindPairingMatch([round()], 9, 0, "m")).toBeNull();
        expect(bindPairingMatch([round()], 1, 6, "m")).toBeNull();
    });
});

describe("unbindPairingMatch (abandoned waiting room, issue #1645)", () => {
    it("clears a dangling Match id so the pairing can be started again", () => {
        const bound = bindPairingMatch([round()], 1, 0, "match-1")!;
        const cleared = unbindPairingMatch(bound, 1, 0)!;
        expect(cleared[0].pairings[0].matchId).toBeUndefined();
        expect(bindPairingMatch(cleared, 1, 0, "match-2")).not.toBeNull();
    });

    it("declines when there is nothing bound, or the pairing is decided", () => {
        expect(unbindPairingMatch([round()], 1, 0)).toBeNull();
        const decided = [
            round({
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        matchId: "match-1",
                        result: { winsA: 1, winsB: 0, source: "played" },
                    },
                ],
            }),
        ];
        expect(unbindPairingMatch(decided, 1, 0)).toBeNull();
    });
});

describe("recordPlayedPairing (PRD #1628 stories 14-15, issue #1645)", () => {
    const bound = () => bindPairingMatch([round()], 1, 0, "match-1")!;

    it("records the score in the EVENT pairing's own seat order when the starter is seatA", () => {
        const next = recordPlayedPairing(
            bound(),
            { round: 1, seatA: 0, seatB: 1 },
            "match-1",
            { winsA: 2, winsB: 1 }
        )!;
        expect(next[0].pairings[0].result).toEqual({
            winsA: 2,
            winsB: 1,
            source: "played",
        });
    });

    it("FLIPS the score when the seat that started the Match is the pairing's seatB", () => {
        // Seat 1 started the Match, so the Match's own `players[0]` is seat 1 —
        // its 2-1 is the pairing's 1-2.
        const next = recordPlayedPairing(
            bound(),
            { round: 1, seatA: 1, seatB: 0 },
            "match-1",
            { winsA: 2, winsB: 1 }
        )!;
        expect(next[0].pairings[0].result).toEqual({
            winsA: 1,
            winsB: 2,
            source: "played",
        });
    });

    it("marks the result `played` — never `simulated`/`bye`/`timeout`", () => {
        const next = recordPlayedPairing(
            bound(),
            { round: 1, seatA: 0, seatB: 1 },
            "match-1",
            { winsA: 1, winsB: 0 }
        )!;
        expect(next[0].pairings[0].result!.source).toBe("played");
    });

    it("refuses a Match id the pairing is not bound to", () => {
        expect(
            recordPlayedPairing(
                bound(),
                { round: 1, seatA: 0, seatB: 1 },
                "match-other",
                { winsA: 2, winsB: 0 }
            )
        ).toBeNull();
        // …and an unbound pairing accepts nothing at all.
        expect(
            recordPlayedPairing(
                [round()],
                { round: 1, seatA: 0, seatB: 1 },
                "match-1",
                { winsA: 2, winsB: 0 }
            )
        ).toBeNull();
    });

    it("is idempotent — the second recording of the same Match writes nothing", () => {
        const once = recordPlayedPairing(
            bound(),
            { round: 1, seatA: 0, seatB: 1 },
            "match-1",
            { winsA: 2, winsB: 0 }
        )!;
        expect(
            recordPlayedPairing(
                once,
                { round: 1, seatA: 0, seatB: 1 },
                "match-1",
                { winsA: 0, winsB: 2 }
            )
        ).toBeNull();
    });

    it("refuses a link naming seats that are not one pairing", () => {
        expect(
            recordPlayedPairing(
                bound(),
                { round: 1, seatA: 0, seatB: 3 },
                "match-1",
                { winsA: 2, winsB: 0 }
            )
        ).toBeNull();
    });

    it("refuses a round that isn't there", () => {
        expect(
            recordPlayedPairing(
                bound(),
                { round: 4, seatA: 0, seatB: 1 },
                "match-1",
                { winsA: 2, winsB: 0 }
            )
        ).toBeNull();
    });

    it("leaves every other pairing untouched", () => {
        const next = recordPlayedPairing(
            bound(),
            { round: 1, seatA: 0, seatB: 1 },
            "match-1",
            { winsA: 2, winsB: 0 }
        )!;
        expect(next[0].pairings[1]).toEqual({ seatA: 2, seatB: 3 });
    });
});
