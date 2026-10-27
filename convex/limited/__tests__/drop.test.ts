// Drop (GLOSSARY.md): a Seat leaving a started Limited Event. Pure-module
// tests for the pieces `leaveLimitedEvent` composes — the Seat flag, the
// draft picks made for a dropped Seat, deck completion, and the concession
// of its pairings.
import { describe, expect, it } from "vitest";
import { dropSeat } from "../eventLogic";
import { isAutoDrivenSeat, isDroppedSeat } from "../droppedSeat";
import { computeEventCompletion } from "../completion";
import { applyPick, runBotAutoPicks, startDraft } from "../draftEngine";
import type { ChooseBotPick } from "../draftEngine";
import {
    advanceRoundIfComplete,
    concedeDroppedPairings,
    openRound,
    type RoundSeatLookup,
} from "../rounds";
import { projectLimitedEvent } from "../eventProjection";
import type { BoosterConfig } from "../boosterTypes";
import type { GetBoosterConfig, ResolveCardMeta } from "../eventLogic";
import type { LimitedEventSeat, LimitedRound } from "../eventTypes";

const NOW = 5_000;

describe("dropSeat", () => {
    const seats: LimitedEventSeat[] = [
        { seatIndex: 0, userId: "u1", nickname: "Ann" },
        { seatIndex: 1, userId: "u2", nickname: "Bo" },
    ];

    it("stamps droppedAt and keeps the occupant", () => {
        const next = dropSeat(seats, "u2", NOW);
        expect(next[1]).toMatchObject({
            userId: "u2",
            nickname: "Bo",
            droppedAt: NOW,
        });
        expect(next[0].droppedAt).toBeUndefined();
        expect(isDroppedSeat(next[1])).toBe(true);
        expect(isAutoDrivenSeat(next[1])).toBe(true);
    });

    it("is idempotent: the original droppedAt survives a second drop", () => {
        const once = dropSeat(seats, "u2", NOW);
        expect(dropSeat(once, "u2", NOW + 99)[1].droppedAt).toBe(NOW);
    });

    it("rejects a user who holds no Seat", () => {
        expect(() => dropSeat(seats, "stranger", NOW)).toThrow(
            /no.*seat|do not have a seat/i
        );
    });
});

describe("computeEventCompletion — a dropped Seat needs no submitted deck", () => {
    it("completes with a dropped human that never built", () => {
        const seats = [{ seatIndex: 0 }, { seatIndex: 1, droppedAt: NOW }];
        const result = computeEventCompletion(
            seats,
            { type: "sealed", status: "started" },
            (seatIndex) => seatIndex === 0
        );
        expect(result.completed).toBe(true);
        expect(result.hasDeckBySeat.has(1)).toBe(true);
    });

    it("an undropped human without a deck still blocks completion", () => {
        const result = computeEventCompletion(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            { type: "sealed", status: "started" },
            (seatIndex) => seatIndex === 0
        );
        expect(result.completed).toBe(false);
    });
});

describe("runBotAutoPicks — a dropped Seat is drafted for", () => {
    const config: BoosterConfig = {
        setCode: "tst1",
        boostersTotalWeight: 1,
        boosters: [{ contents: { common: 3 }, weight: 1 }],
        sheets: {
            common: {
                cards: { a: 1, b: 1, c: 1, d: 1 },
                totalWeight: 4,
            },
        },
    };
    const getConfig: GetBoosterConfig = (code) =>
        code === "tst1" ? config : null;
    const resolveCardMeta: ResolveCardMeta = (id) => ({
        cardId: id,
        cardName: id,
    });
    const firstCard: ChooseBotPick = (_seat, pack) => pack[0].pickId;

    it("makes the dropped Seat's current and later picks without input", () => {
        const dealt = startDraft(
            [{ seatIndex: 0 }, { seatIndex: 1 }],
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta
        );
        const withDrop = dealt.seats.map((seat) =>
            seat.seatIndex === 1 ? { ...seat, droppedAt: NOW } : seat
        );
        const afterDrop = runBotAutoPicks(
            withDrop,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta,
            firstCard
        );
        expect(afterDrop.seats[1].pool).toHaveLength(1);
        expect(afterDrop.seats[0].pool ?? []).toHaveLength(0);

        // The human takes a card; the pack lands on the dropped Seat, which
        // picks it at once — nothing waits on it.
        const humanPick = applyPick(
            afterDrop.seats,
            afterDrop.draftRound,
            afterDrop.draftPacksRemaining,
            ["tst1"],
            0,
            afterDrop.seats[0].currentPack![0].pickId,
            42,
            getConfig,
            resolveCardMeta
        );
        const afterHuman = runBotAutoPicks(
            humanPick.seats,
            humanPick.draftRound,
            humanPick.draftPacksRemaining,
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta,
            firstCard,
            humanPick.completed
        );
        expect(afterHuman.seats[1].pool).toHaveLength(2);
        expect(afterHuman.seats[1].currentPack ?? []).toHaveLength(0);
    });
});

describe("Round concessions", () => {
    const table = (dropped: number[]): RoundSeatLookup[] =>
        Array.from({ length: 4 }, (_, seatIndex) => ({
            seatIndex,
            ...(dropped.includes(seatIndex) ? { droppedAt: NOW } : {}),
        }));
    const open = (
        seats: RoundSeatLookup[],
        roundNumber = 1,
        previousRounds: LimitedRound[] = []
    ) =>
        openRound({
            eventId: "e1",
            roundNumber,
            seats,
            previousRounds,
            gamesFormat: "bo3",
            startedAt: 1,
            seatStrength: () => ({ mean: 2 }),
        });

    it("a pairing with a dropped human resolves as a concession on open", () => {
        const round = open(table([2]));
        const pairing = round.pairings.find(
            (p) => p.seatA === 2 || p.seatB === 2
        )!;
        const droppedIsA = pairing.seatA === 2;
        expect(pairing.result).toEqual({
            winsA: droppedIsA ? 0 : 2,
            winsB: droppedIsA ? 2 : 0,
            source: "concession",
        });
        // The other pairing (two undropped humans) still waits.
        const other = round.pairings.find((p) => p !== pairing)!;
        expect(other.result).toBeUndefined();
    });

    it("two dropped Seats paired together draw 0-0", () => {
        const round = open(table([0, 1, 2, 3]));
        for (const p of round.pairings) {
            expect(p.result).toEqual({
                winsA: 0,
                winsB: 0,
                source: "concession",
            });
        }
    });

    it("concedeDroppedPairings decides the undecided pairing and is idempotent", () => {
        const round = open(table([]));
        expect(round.pairings.every((p) => p.result === undefined)).toBe(true);
        const seats = table([round.pairings[0].seatA]);
        const once = concedeDroppedPairings({
            rounds: [round],
            seats,
            gamesFormat: "bo3",
        });
        expect(once[0].pairings[0].result?.source).toBe("concession");
        expect(once[0].pairings[0].result?.winsA).toBe(0);
        expect(once[0].pairings[1].result).toBeUndefined();
        const twice = concedeDroppedPairings({
            rounds: once,
            seats,
            gamesFormat: "bo3",
        });
        expect(twice).toEqual(once);
    });

    it("the round cascade concedes the dropped Seat's later pairings", () => {
        const seats = table([3]);
        const round1 = open(table([]));
        // Round 1 played out normally: seat A of each pairing wins.
        const decided: LimitedRound = {
            ...round1,
            pairings: round1.pairings.map((p) => ({
                ...p,
                result: { winsA: 2, winsB: 0, source: "played" as const },
            })),
        };
        const advance = advanceRoundIfComplete({
            eventId: "e1",
            seats,
            rounds: [decided],
            gamesFormat: "bo3",
            now: 2,
            seatStrength: () => ({ mean: 2 }),
        });
        expect(advance.kind).not.toBe("unchanged");
        if (advance.kind === "unchanged") return;
        const round2 = advance.rounds[1];
        const droppedPairing = round2.pairings.find(
            (p) => p.seatA === 3 || p.seatB === 3
        )!;
        expect(droppedPairing.result?.source).toBe("concession");
    });
});

describe("projectLimitedEvent — the Dropped marker reaches the wire", () => {
    it("carries isDropped per seat", () => {
        const view = projectLimitedEvent(
            {
                _id: "e1",
                createdBy: "u1",
                type: "sealed",
                status: "playing",
                seatCount: 2,
                packSlots: ["tst1"],
                timerEnabled: false,
                createdAt: 1,
                updatedAt: 1,
                seats: [
                    { seatIndex: 0, userId: "u1", nickname: "Ann" },
                    {
                        seatIndex: 1,
                        userId: "u2",
                        nickname: "Bo",
                        droppedAt: NOW,
                    },
                ],
            } as unknown as Parameters<typeof projectLimitedEvent>[0],
            "u1",
            true,
            2,
            new Map(),
            new Set([0, 1]),
            false
        );
        expect(view.seats.map((s) => s.isDropped)).toEqual([false, true]);
    });
});
