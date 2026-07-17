// Draft engine tests (PRD #1107 stories 10-16, ADR 0054/0055, issue #1112):
// deterministic unit tests for pick application, pack-pass direction per
// booster round, queueing when picks diverge in speed, and round/draft
// advancement — mirrors `eventLogic.test.ts`'s discipline (pure functions,
// no convex-test harness needed).
import { describe, it, expect } from "vitest";
import {
    applyPick,
    passDirection,
    roundSeed,
    startDraft,
} from "../draftEngine";
import { CUBE_SOURCE_KEY, CUBE_PACK_SIZE } from "../cube";
import type { GetBoosterConfig, ResolveCardMeta } from "../eventLogic";
import type { BoosterConfig } from "../boosterTypes";
import type { LimitedEventSeat, DraftPackCard } from "../eventTypes";

// A tiny single-sheet config: `cardsPerPack` cards drawn from a 4-entry
// common sheet — small enough to fully deplete a pack in a handful of picks
// so round-advancement tests stay short, while still exercising the real
// `generateBooster` weighted-sampling path (not a hand-rolled stub).
function tinyConfig(setCode: string, cardsPerPack: number): BoosterConfig {
    return {
        setCode,
        boostersTotalWeight: 1,
        boosters: [{ contents: { common: cardsPerPack }, weight: 1 }],
        sheets: {
            common: {
                cards: {
                    "common-a": 1,
                    "common-b": 1,
                    "common-c": 1,
                    "common-d": 1,
                },
                totalWeight: 4,
            },
        },
    };
}

const configs: Record<string, BoosterConfig> = {
    tst1: tinyConfig("tst1", 3),
    tst2: tinyConfig("tst2", 3),
};
const getConfig: GetBoosterConfig = (setCode) => configs[setCode] ?? null;
const resolveCardMeta: ResolveCardMeta = (scryfallId) => ({
    cardId: scryfallId,
    cardName: scryfallId.toUpperCase(),
});

function seatsOf(n: number): LimitedEventSeat[] {
    return Array.from({ length: n }, (_, seatIndex) => ({ seatIndex }));
}

describe("passDirection (PRD #1107 story 12: left, then right, then left)", () => {
    it("alternates +1 (left) / -1 (right) starting at round 0", () => {
        expect(passDirection(0)).toBe(1);
        expect(passDirection(1)).toBe(-1);
        expect(passDirection(2)).toBe(1);
        expect(passDirection(3)).toBe(-1);
    });
});

describe("roundSeed", () => {
    it("is deterministic and differs per round", () => {
        expect(roundSeed(42, 0)).toBe(roundSeed(42, 0));
        expect(roundSeed(42, 0)).not.toBe(roundSeed(42, 1));
    });
});

describe("startDraft (PRD #1107 stories 10-11)", () => {
    it("deals one Booster per seat as its currentPack", () => {
        const result = startDraft(
            seatsOf(3),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta
        );
        expect(result.draftRound).toBe(0);
        expect(result.draftPacksRemaining).toBe(3);
        for (const seat of result.seats) {
            expect(seat.currentPack).toHaveLength(3);
            expect(seat.pool).toEqual([]);
            expect(seat.packQueue).toEqual([]);
        }
    });

    it("assigns a pickId unique across the whole round", () => {
        const result = startDraft(
            seatsOf(4),
            ["tst1"],
            7,
            getConfig,
            resolveCardMeta
        );
        const allPickIds = result.seats.flatMap((s) =>
            (s.currentPack ?? []).map((c) => c.pickId)
        );
        expect(new Set(allPickIds).size).toBe(allPickIds.length);
        expect(allPickIds).toHaveLength(4 * 3);
    });

    it("is deterministic: the same seed deals byte-identical packs", () => {
        const run = () =>
            startDraft(seatsOf(3), ["tst1"], 1234, getConfig, resolveCardMeta);
        expect(run()).toEqual(run());
    });

    it("throws when packSlots is empty", () => {
        expect(() =>
            startDraft(seatsOf(2), [], 1, getConfig, resolveCardMeta)
        ).toThrow(/packSlots is empty/);
    });

    it("throws when a packSlot references an unresolvable set", () => {
        expect(() =>
            startDraft(
                seatsOf(2),
                ["unknown-set"],
                1,
                getConfig,
                resolveCardMeta
            )
        ).toThrow(/no Booster Config/);
    });

    it("does not mutate the input seats array (pure)", () => {
        const seats = seatsOf(2);
        const before = JSON.stringify(seats);
        startDraft(seats, ["tst1"], 1, getConfig, resolveCardMeta);
        expect(JSON.stringify(seats)).toBe(before);
    });
});

describe("applyPick — a single pick with no pack empty (PRD #1107 story 10)", () => {
    it("moves the picked card from currentPack into the seat's pool", () => {
        const start = startDraft(
            seatsOf(3),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta
        );
        const pack0 = start.seats[0].currentPack as DraftPackCard[];
        const pickId = pack0[0].pickId;

        const result = applyPick(
            start.seats,
            start.draftRound,
            start.draftPacksRemaining,
            ["tst1"],
            0,
            pickId,
            42,
            getConfig,
            resolveCardMeta
        );

        expect(result.seats[0].pool).toEqual([
            {
                scryfallId: pack0[0].scryfallId,
                cardId: pack0[0].cardId,
                cardName: pack0[0].cardName,
            },
        ]);
        expect(result.completed).toBe(false);
        expect(result.draftPacksRemaining).toBe(3);
        expect(result.draftRound).toBe(0);
    });

    it("clears the picker's currentPack when nothing is queued", () => {
        const start = startDraft(
            seatsOf(3),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta
        );
        const pickId = (start.seats[0].currentPack as DraftPackCard[])[0]
            .pickId;
        const result = applyPick(
            start.seats,
            start.draftRound,
            start.draftPacksRemaining,
            ["tst1"],
            0,
            pickId,
            42,
            getConfig,
            resolveCardMeta
        );
        expect(result.seats[0].currentPack).toBeUndefined();
    });

    it("passes the remaining pack left (round 0) into the neighbor's queue when the neighbor's own pack is still non-empty", () => {
        const start = startDraft(
            seatsOf(3),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta
        );
        const pack0 = start.seats[0].currentPack as DraftPackCard[];
        const pickId = pack0[0].pickId;
        const remainingIds = pack0.slice(1).map((c) => c.pickId);

        const result = applyPick(
            start.seats,
            start.draftRound,
            start.draftPacksRemaining,
            ["tst1"],
            0,
            pickId,
            42,
            getConfig,
            resolveCardMeta
        );

        // Seat 1 ("left" of seat 0) already holds its own currentPack, so
        // the passed pack queues rather than replacing it.
        expect(result.seats[1].currentPack).toEqual(start.seats[1].currentPack);
        expect(result.seats[1].packQueue).toHaveLength(1);
        expect(result.seats[1].packQueue![0].map((c) => c.pickId)).toEqual(
            remainingIds
        );
        // Untouched third seat.
        expect(result.seats[2]).toEqual(start.seats[2]);
    });

    it("does not mutate the input seats array (pure)", () => {
        const start = startDraft(
            seatsOf(3),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta
        );
        const before = JSON.stringify(start.seats);
        const pickId = (start.seats[0].currentPack as DraftPackCard[])[0]
            .pickId;
        applyPick(
            start.seats,
            start.draftRound,
            start.draftPacksRemaining,
            ["tst1"],
            0,
            pickId,
            42,
            getConfig,
            resolveCardMeta
        );
        expect(JSON.stringify(start.seats)).toBe(before);
    });
});

describe("applyPick — validation", () => {
    it("throws for an out-of-range seat index", () => {
        const start = startDraft(
            seatsOf(2),
            ["tst1"],
            1,
            getConfig,
            resolveCardMeta
        );
        expect(() =>
            applyPick(
                start.seats,
                0,
                2,
                ["tst1"],
                5,
                "whatever",
                1,
                getConfig,
                resolveCardMeta
            )
        ).toThrow(/invalid seat index/);
    });

    it("throws when the seat has no currentPack", () => {
        const seats: LimitedEventSeat[] = [
            { seatIndex: 0, pool: [] },
            { seatIndex: 1, currentPack: [] },
        ];
        expect(() =>
            applyPick(
                seats,
                0,
                2,
                ["tst1"],
                0,
                "anything",
                1,
                getConfig,
                resolveCardMeta
            )
        ).toThrow(/no pack to pick from/);
        expect(() =>
            applyPick(
                seats,
                0,
                2,
                ["tst1"],
                1,
                "anything",
                1,
                getConfig,
                resolveCardMeta
            )
        ).toThrow(/no pack to pick from/);
    });

    it("throws when pickId isn't in the current pack", () => {
        const start = startDraft(
            seatsOf(2),
            ["tst1"],
            1,
            getConfig,
            resolveCardMeta
        );
        expect(() =>
            applyPick(
                start.seats,
                0,
                2,
                ["tst1"],
                0,
                "not-a-real-pick-id",
                1,
                getConfig,
                resolveCardMeta
            )
        ).toThrow(/not in your current pack/);
    });
});

describe("applyPick — fast seat dequeues its own queued pack", () => {
    it("promotes the oldest queued pack to currentPack once the current one empties", () => {
        const cardA: DraftPackCard = {
            scryfallId: "a",
            cardId: "a",
            cardName: "A",
            pickId: "pick-a",
        };
        const cardB: DraftPackCard = {
            scryfallId: "b",
            cardId: "b",
            cardName: "B",
            pickId: "pick-b",
        };
        const cardC: DraftPackCard = {
            scryfallId: "c",
            cardId: "c",
            cardName: "C",
            pickId: "pick-c",
        };
        const seats: LimitedEventSeat[] = [
            {
                seatIndex: 0,
                pool: [],
                currentPack: [cardA],
                packQueue: [[cardB, cardC]],
            },
            { seatIndex: 1, pool: [], currentPack: [], packQueue: [] },
        ];

        const result = applyPick(
            seats,
            0,
            5,
            ["tst1"],
            0,
            "pick-a",
            1,
            getConfig,
            resolveCardMeta
        );

        expect(result.seats[0].currentPack).toEqual([cardB, cardC]);
        expect(result.seats[0].packQueue).toEqual([]);
        expect(result.seats[0].pool).toEqual([
            { scryfallId: "a", cardId: "a", cardName: "A" },
        ]);
        // The now-empty pack A retired without being passed anywhere.
        expect(result.draftPacksRemaining).toBe(4);
    });
});

describe("applyPick — round advancement and draft completion (PRD #1107 stories 12, 26)", () => {
    it("deals the next round's boosters once every pack in the round is exhausted", () => {
        // 2 seats, 1-card packs: round finishes after exactly 2 picks.
        const single: Record<string, BoosterConfig> = {
            r0: tinyConfig("r0", 1),
            r1: tinyConfig("r1", 1),
        };
        const oneCardConfig: GetBoosterConfig = (setCode) =>
            single[setCode] ?? null;

        const state = startDraft(
            seatsOf(2),
            ["r0", "r1"],
            99,
            oneCardConfig,
            resolveCardMeta
        );
        expect(state.draftRound).toBe(0);
        expect(state.draftPacksRemaining).toBe(2);

        const pick0 = (state.seats[0].currentPack as DraftPackCard[])[0].pickId;
        let result = applyPick(
            state.seats,
            state.draftRound,
            state.draftPacksRemaining,
            ["r0", "r1"],
            0,
            pick0,
            99,
            oneCardConfig,
            resolveCardMeta
        );
        expect(result.completed).toBe(false);
        expect(result.draftRound).toBe(0);
        expect(result.draftPacksRemaining).toBe(1);

        const pick1 = (result.seats[1].currentPack as DraftPackCard[])[0]
            .pickId;
        result = applyPick(
            result.seats,
            result.draftRound,
            result.draftPacksRemaining,
            ["r0", "r1"],
            1,
            pick1,
            99,
            oneCardConfig,
            resolveCardMeta
        );

        expect(result.completed).toBe(false);
        expect(result.draftRound).toBe(1);
        expect(result.draftPacksRemaining).toBe(2);
        for (const seat of result.seats) {
            expect(seat.currentPack).toHaveLength(1);
            expect(seat.currentPack![0].pickId).toMatch(/^r1-/);
            expect(seat.packQueue).toEqual([]);
        }
    });

    it("marks the draft completed once the last pack of the last round empties", () => {
        const single: Record<string, BoosterConfig> = {
            solo: tinyConfig("solo", 1),
        };
        const oneCardConfig: GetBoosterConfig = (setCode) =>
            single[setCode] ?? null;

        const state = startDraft(
            seatsOf(2),
            ["solo"],
            5,
            oneCardConfig,
            resolveCardMeta
        );
        const pick0 = (state.seats[0].currentPack as DraftPackCard[])[0].pickId;
        let result = applyPick(
            state.seats,
            state.draftRound,
            state.draftPacksRemaining,
            ["solo"],
            0,
            pick0,
            5,
            oneCardConfig,
            resolveCardMeta
        );
        expect(result.completed).toBe(false);

        const pick1 = (result.seats[1].currentPack as DraftPackCard[])[0]
            .pickId;
        result = applyPick(
            result.seats,
            result.draftRound,
            result.draftPacksRemaining,
            ["solo"],
            1,
            pick1,
            5,
            oneCardConfig,
            resolveCardMeta
        );

        expect(result.completed).toBe(true);
        expect(result.seats[0].pool).toHaveLength(1);
        expect(result.seats[1].pool).toHaveLength(1);
        expect(result.seats[0].currentPack).toBeUndefined();
        expect(result.seats[1].currentPack).toBeUndefined();
    });
});

// Issue #1246: the create path was emitting a single-element `packSlots` for
// EVERY Draft, so `applyPick`'s round-advance condition (`round <
// packSlots.length - 1`) never advanced past round 0 — a real Draft ended
// after one booster. These tests drive a genuine THREE-element `packSlots`
// (the shape the fixed create dialog now emits) all the way to completion,
// asserting `completed` stays false after boosters 1 AND 2 and only flips
// true after the third — and that a heterogeneous 3-set list (the
// already-supported multi-set shape, e.g. a future block draft) deals the
// correct set each round.
describe("applyPick — 3-booster Draft completion (issue #1246, PRD #1241 story 6)", () => {
    it("stays incomplete after boosters 1 and 2 and completes only after the third, homogeneous packSlots (3× the same set)", () => {
        const single: Record<string, BoosterConfig> = {
            solo: tinyConfig("solo", 1),
        };
        const oneCardConfig: GetBoosterConfig = (setCode) =>
            single[setCode] ?? null;
        const packSlots = ["solo", "solo", "solo"];

        const state = startDraft(
            seatsOf(2),
            packSlots,
            7,
            oneCardConfig,
            resolveCardMeta
        );
        let round = state.draftRound;
        let remaining = state.draftPacksRemaining;
        let seats = state.seats;
        let completed = false;

        // 3 rounds × 2 seats × 1-card packs = 6 total picks before completion.
        for (let pick = 0; pick < 6; pick++) {
            const seatIndex = seats.findIndex(
                (s) => s.currentPack && s.currentPack.length > 0
            );
            expect(seatIndex).not.toBe(-1);
            const pickId = seats[seatIndex].currentPack![0].pickId;
            const result = applyPick(
                seats,
                round,
                remaining,
                packSlots,
                seatIndex,
                pickId,
                7,
                oneCardConfig,
                resolveCardMeta
            );
            seats = result.seats;
            round = result.draftRound;
            remaining = result.draftPacksRemaining;
            completed = result.completed;

            if (pick < 5) {
                // Not yet the very last pick of the last round.
                expect(completed).toBe(false);
            }
        }

        expect(completed).toBe(true);
        for (const seat of seats) {
            // 3 boosters × 1 card/booster = 3 cards in the final Pool —
            // proof all three rounds actually dealt and were picked, not
            // just the first.
            expect(seat.pool).toHaveLength(3);
            expect(seat.currentPack).toBeUndefined();
        }
    });

    it("deals the correct DISTINCT set each round for a heterogeneous 3-set packSlots (multi-set / future block draft)", () => {
        const three: Record<string, BoosterConfig> = {
            inv: tinyConfig("inv", 1),
            pls: tinyConfig("pls", 1),
            apc: tinyConfig("apc", 1),
        };
        const threeSetConfig: GetBoosterConfig = (setCode) =>
            three[setCode] ?? null;
        const packSlots = ["inv", "pls", "apc"];

        const state = startDraft(
            seatsOf(2),
            packSlots,
            11,
            threeSetConfig,
            resolveCardMeta
        );
        // Round 0 packs are stamped with an "r0-" pickId prefix (see
        // `generateRoundPacks`) — the round-0 set is whichever config
        // `packSlots[0]` ("inv") resolves to; content is opaque here (the
        // tiny config's cards are named "common-a".."d" regardless of set),
        // so the round tag on `pickId` is what proves the RIGHT slot fed
        // this round, not merely "some" config.
        for (const seat of state.seats) {
            expect(seat.currentPack![0].pickId).toMatch(/^r0-/);
        }

        let round = state.draftRound;
        let remaining = state.draftPacksRemaining;
        let seats = state.seats;
        let completed = false;

        for (let pick = 0; pick < 2; pick++) {
            const seatIndex = seats.findIndex(
                (s) => s.currentPack && s.currentPack.length > 0
            );
            const pickId = seats[seatIndex].currentPack![0].pickId;
            const result = applyPick(
                seats,
                round,
                remaining,
                packSlots,
                seatIndex,
                pickId,
                11,
                threeSetConfig,
                resolveCardMeta
            );
            seats = result.seats;
            round = result.draftRound;
            remaining = result.draftPacksRemaining;
            completed = result.completed;
        }
        expect(completed).toBe(false);
        expect(round).toBe(1);
        for (const seat of seats) {
            expect(seat.currentPack![0].pickId).toMatch(/^r1-/);
        }

        for (let pick = 0; pick < 2; pick++) {
            const seatIndex = seats.findIndex(
                (s) => s.currentPack && s.currentPack.length > 0
            );
            const pickId = seats[seatIndex].currentPack![0].pickId;
            const result = applyPick(
                seats,
                round,
                remaining,
                packSlots,
                seatIndex,
                pickId,
                11,
                threeSetConfig,
                resolveCardMeta
            );
            seats = result.seats;
            round = result.draftRound;
            remaining = result.draftPacksRemaining;
            completed = result.completed;
        }
        expect(completed).toBe(false);
        expect(round).toBe(2);
        for (const seat of seats) {
            expect(seat.currentPack![0].pickId).toMatch(/^r2-/);
        }

        for (let pick = 0; pick < 2; pick++) {
            const seatIndex = seats.findIndex(
                (s) => s.currentPack && s.currentPack.length > 0
            );
            const pickId = seats[seatIndex].currentPack![0].pickId;
            const result = applyPick(
                seats,
                round,
                remaining,
                packSlots,
                seatIndex,
                pickId,
                11,
                threeSetConfig,
                resolveCardMeta
            );
            seats = result.seats;
            round = result.draftRound;
            remaining = result.draftPacksRemaining;
            completed = result.completed;
        }
        expect(completed).toBe(true);
        for (const seat of seats) {
            expect(seat.pool).toHaveLength(3);
        }
    });
});

describe("applyPick — full 3-seat round trace (queueing under diverging pick speed)", () => {
    it("every pack visits every seat exactly once per lap and the round completes with correct pools", () => {
        // 3 seats, 2-card packs (booster size == seat count so each pack
        // laps the table exactly once before emptying) — traces the queueing
        // interleaving documented in draftEngine.ts's applyPick doc comment.
        const twoCard: Record<string, BoosterConfig> = {
            lap: tinyConfig("lap", 2),
        };
        const twoCardConfig: GetBoosterConfig = (setCode) =>
            twoCard[setCode] ?? null;

        const state = startDraft(
            seatsOf(3),
            ["lap"],
            17,
            twoCardConfig,
            resolveCardMeta
        );
        let round = state.draftRound;
        let remaining = state.draftPacksRemaining;
        let seats = state.seats;

        // Deterministic pick order matching the hand-traced example: seat0,
        // seat1, seat2, then seat0, seat1, seat2 again (6 picks total).
        for (const seatIndex of [0, 1, 2, 0, 1, 2]) {
            const pack = seats[seatIndex].currentPack;
            expect(pack).toBeDefined();
            expect(pack!.length).toBeGreaterThan(0);
            const pickId = pack![0].pickId;
            const result = applyPick(
                seats,
                round,
                remaining,
                ["lap"],
                seatIndex,
                pickId,
                17,
                twoCardConfig,
                resolveCardMeta
            );
            seats = result.seats;
            round = result.draftRound;
            remaining = result.draftPacksRemaining;
        }

        expect(remaining).toBe(0);
        for (const seat of seats) {
            expect(seat.pool).toHaveLength(2);
            expect(seat.currentPack).toBeUndefined();
            expect(seat.packQueue).toEqual([]);
        }
    });
});

describe("Vintage Cube pool source through the real engine (ADR 0062)", () => {
    // The cube key never reaches `getConfig` — `generateRoundPacks`
    // special-cases it before the Booster Config lookup — so a null-returning
    // stub is correct here (and proves the cube path bypasses it entirely).
    const noConfig: GetBoosterConfig = () => null;
    const cubeSlots = [CUBE_SOURCE_KEY, CUBE_SOURCE_KEY, CUBE_SOURCE_KEY];

    it("startDraft deals 15-card cube packs to every seat", () => {
        const dealt = startDraft(
            seatsOf(2),
            cubeSlots,
            4242,
            noConfig,
            resolveCardMeta
        );
        for (const seat of dealt.seats) {
            expect(seat.currentPack).toHaveLength(CUBE_PACK_SIZE);
        }
        expect(dealt.draftPacksRemaining).toBe(2);
    });

    it("is deterministic given a fixed event seed", () => {
        const a = startDraft(
            seatsOf(2),
            cubeSlots,
            7,
            noConfig,
            resolveCardMeta
        );
        const b = startDraft(
            seatsOf(2),
            cubeSlots,
            7,
            noConfig,
            resolveCardMeta
        );
        expect(a.seats.map((s) => s.currentPack)).toEqual(
            b.seats.map((s) => s.currentPack)
        );
    });

    it("runs a full 2-seat draft SINGLETON (283-card pool ≥ 2*15*3=90)", () => {
        // Drive every pick manually (take the first card of whichever seat
        // currently holds a pack), exactly the loop a real submit/bot pick
        // follows — proving cube packs feed the existing pick pipeline
        // unchanged, and that no card is dealt twice across the whole draft.
        let seats = startDraft(
            seatsOf(2),
            cubeSlots,
            555,
            noConfig,
            resolveCardMeta
        ).seats;
        let round = 0;
        let remaining = 2;
        let completed = false;
        for (let guard = 0; guard < 1000 && !completed; guard++) {
            const seatIndex = seats.findIndex(
                (s) => s.currentPack && s.currentPack.length > 0
            );
            if (seatIndex === -1) break;
            const result = applyPick(
                seats,
                round,
                remaining,
                cubeSlots,
                seatIndex,
                seats[seatIndex].currentPack![0].pickId,
                555,
                noConfig,
                resolveCardMeta
            );
            seats = result.seats;
            round = result.draftRound;
            remaining = result.draftPacksRemaining;
            completed = result.completed;
        }

        expect(completed).toBe(true);
        const allPicked: string[] = [];
        for (const seat of seats) {
            expect(seat.pool).toHaveLength(3 * CUBE_PACK_SIZE); // 45
            allPicked.push(...seat.pool!.map((c) => c.scryfallId));
        }
        expect(allPicked).toHaveLength(90);
        // Singleton: every one of the 90 dealt cards is distinct.
        expect(new Set(allPicked).size).toBe(90);
    });
});
