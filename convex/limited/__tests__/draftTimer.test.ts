// Draft Timer + Auto-Pick engine tests (issue #1114, PRD #1107 stories 5, 14,
// 16, 27; ADR 0054/0055). Mirrors `draftEngine.test.ts`'s discipline: pure
// functions, no convex-test harness needed. Covers the `TimerConfig`
// stamping `startDraft`/`applyPick`/`runBotAutoPicks` do when a timer is
// configured, and the `resolveAutoPickTimeout` seq-based cancellation guard
// `convex/limitedEvents.ts`'s `autoPickSeatTimeout` internalMutation is a
// thin shell around.
import { describe, it, expect } from "vitest";
import {
    applyPick,
    resolveAutoPickTimeout,
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
    type TimerConfig,
} from "../draftEngine";
import type { GetBoosterConfig, ResolveCardMeta } from "../eventLogic";
import type { BoosterConfig } from "../boosterTypes";
import type { DraftPackCard, LimitedEventSeat } from "../eventTypes";

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
};
const getConfig: GetBoosterConfig = (setCode) => configs[setCode] ?? null;
const resolveCardMeta: ResolveCardMeta = (scryfallId) => ({
    cardId: scryfallId,
    cardName: scryfallId.toUpperCase(),
});

function seatsOf(n: number): LimitedEventSeat[] {
    return Array.from({ length: n }, (_, seatIndex) => ({ seatIndex }));
}

/** Deterministic stand-in for the real Pick Heuristic — always the first
 *  card in the pack. Fine for exercising the timer/queue plumbing; the
 *  "Auto-Pick uses the SAME bot pick engine" acceptance criterion is proven
 *  separately in `convex/__tests__/limitedEvents.test.ts` against the real
 *  `chooseBotPick`. */
const firstCardPick: ChooseBotPick = (_seat, pack) => pack[0].pickId;

const NOW = 1_000_000;
const TIMER_SECONDS = 30;
const timerConfig: TimerConfig = { timerSeconds: TIMER_SECONDS, now: NOW };

describe("startDraft — timer stamping (issue #1114)", () => {
    it("stamps every non-bot seat with pickDeadline/pickSeq and returns one timerUpdate each", () => {
        const seats: LimitedEventSeat[] = [
            { seatIndex: 0 },
            { seatIndex: 1, isBot: true },
            { seatIndex: 2 },
        ];
        const result = startDraft(
            seats,
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta,
            timerConfig
        );

        expect(result.seats[0].pickDeadline).toBe(
            NOW + TIMER_SECONDS * 1000
        );
        expect(result.seats[0].pickSeq).toBe(1);
        expect(result.seats[2].pickDeadline).toBe(
            NOW + TIMER_SECONDS * 1000
        );
        expect(result.seats[2].pickSeq).toBe(1);

        // Bot seats never idle on a pack (runBotAutoPicks always resolves it
        // within the same call) — no deadline/seq is ever stamped for one.
        expect(result.seats[1].pickDeadline).toBeUndefined();
        expect(result.seats[1].pickSeq).toBeUndefined();

        expect(result.timerUpdates).toEqual(
            expect.arrayContaining([
                { seatIndex: 0, pickSeq: 1 },
                { seatIndex: 2, pickSeq: 1 },
            ])
        );
        expect(result.timerUpdates).toHaveLength(2);
    });

    it("stamps nothing and returns no timerUpdates when no TimerConfig is passed (timer-off event)", () => {
        const result = startDraft(
            seatsOf(2),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta
            // no timerConfig — mirrors every pre-#1114 call site
        );
        for (const seat of result.seats) {
            expect(seat.pickDeadline).toBeUndefined();
            expect(seat.pickSeq).toBeUndefined();
        }
        expect(result.timerUpdates).toEqual([]);
    });
});

describe("applyPick — timer stamping and clearing (issue #1114)", () => {
    it("clears the picker's pickDeadline once its currentPack empties with nothing queued", () => {
        const start = startDraft(
            seatsOf(2),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta,
            timerConfig
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
            resolveCardMeta,
            timerConfig
        );
        expect(result.seats[0].currentPack).toBeUndefined();
        expect(result.seats[0].pickDeadline).toBeUndefined();
    });

    it("bumps pickSeq and stamps a fresh deadline when the pass target seat's OWN pack was already empty", () => {
        const start = startDraft(
            seatsOf(3),
            ["tst1"],
            42,
            getConfig,
            resolveCardMeta,
            timerConfig
        );
        // Seat 1 picks first: its currentPack clears to undefined (nothing
        // queued yet) and its remainder passes to seat 2 (round 0 passes
        // left, +1) — seat 2 still holds its own non-empty pack, so this
        // queues rather than stamping.
        const afterSeat1 = applyPick(
            start.seats,
            start.draftRound,
            start.draftPacksRemaining,
            ["tst1"],
            1,
            (start.seats[1].currentPack as DraftPackCard[])[0].pickId,
            42,
            getConfig,
            resolveCardMeta,
            timerConfig
        );
        expect(afterSeat1.seats[1].currentPack).toBeUndefined();

        // Now seat 0 picks: its remainder passes to seat 1, whose
        // currentPack is CURRENTLY empty — this is the fresh-stamp path.
        const afterSeat0 = applyPick(
            afterSeat1.seats,
            afterSeat1.draftRound,
            afterSeat1.draftPacksRemaining,
            ["tst1"],
            0,
            (afterSeat1.seats[0].currentPack as DraftPackCard[])[0].pickId,
            42,
            getConfig,
            resolveCardMeta,
            timerConfig
        );

        expect(afterSeat0.seats[1].currentPack).toHaveLength(2);
        expect(afterSeat0.seats[1].pickSeq).toBe(2); // round-0 deal (1) + this fresh pass (2)
        expect(afterSeat0.seats[1].pickDeadline).toBe(
            NOW + TIMER_SECONDS * 1000
        );
        expect(afterSeat0.timerUpdates).toEqual([
            { seatIndex: 1, pickSeq: 2 },
        ]);
    });

    it("bumps the picker's own pickSeq when it dequeues an already-queued pack", () => {
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
        const seats: LimitedEventSeat[] = [
            {
                seatIndex: 0,
                pool: [],
                currentPack: [cardA],
                packQueue: [[cardB]],
                pickSeq: 1,
                pickDeadline: NOW - 500, // an already-expired deadline
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
            resolveCardMeta,
            timerConfig
        );

        expect(result.seats[0].currentPack).toEqual([cardB]);
        expect(result.seats[0].pickSeq).toBe(2);
        expect(result.seats[0].pickDeadline).toBe(NOW + TIMER_SECONDS * 1000);
        expect(result.timerUpdates).toEqual([{ seatIndex: 0, pickSeq: 2 }]);
    });

    it("re-stamps every non-bot seat on round advancement, leaving bot seats unstamped", () => {
        const single: Record<string, BoosterConfig> = {
            r0: tinyConfig("r0", 1),
            r1: tinyConfig("r1", 1),
        };
        const oneCardConfig: GetBoosterConfig = (setCode) =>
            single[setCode] ?? null;

        const seats: LimitedEventSeat[] = [
            { seatIndex: 0 },
            { seatIndex: 1, isBot: true },
        ];
        const state = startDraft(
            seats,
            ["r0", "r1"],
            99,
            oneCardConfig,
            resolveCardMeta,
            timerConfig
        );
        // Seat 1 is a bot and never got stamped by startDraft — pick it via
        // the plain function directly (bypassing runBotAutoPicks, which
        // isn't the concern of this test) to trigger round advancement.
        let result = applyPick(
            state.seats,
            state.draftRound,
            state.draftPacksRemaining,
            ["r0", "r1"],
            0,
            (state.seats[0].currentPack as DraftPackCard[])[0].pickId,
            99,
            oneCardConfig,
            resolveCardMeta,
            timerConfig
        );
        result = applyPick(
            result.seats,
            result.draftRound,
            result.draftPacksRemaining,
            ["r0", "r1"],
            1,
            (result.seats[1].currentPack as DraftPackCard[])[0].pickId,
            99,
            oneCardConfig,
            resolveCardMeta,
            timerConfig
        );

        expect(result.draftRound).toBe(1);
        expect(result.seats[0].pickDeadline).toBe(NOW + TIMER_SECONDS * 1000);
        expect(result.seats[0].pickSeq).toBe(2); // round-0 stamp (1) + round-1 stamp (2)
        expect(result.seats[1].pickDeadline).toBeUndefined(); // bot: never stamped
        expect(result.seats[1].pickSeq).toBeUndefined();
        expect(result.timerUpdates.filter((u) => u.seatIndex === 0)).toEqual(
            expect.arrayContaining([{ seatIndex: 0, pickSeq: 2 }])
        );
    });
});

describe("resolveAutoPickTimeout — seq-based cancellation guard (issue #1114)", () => {
    function humanSeatWithPack(pickSeq: number): LimitedEventSeat {
        return {
            seatIndex: 0,
            pool: [],
            currentPack: [
                {
                    scryfallId: "common-a",
                    cardId: "common-a",
                    cardName: "COMMON-A",
                    pickId: "r0-p0-c0",
                },
                {
                    scryfallId: "common-b",
                    cardId: "common-b",
                    cardName: "COMMON-B",
                    pickId: "r0-p0-c1",
                },
            ],
            pickSeq,
            pickDeadline: NOW + TIMER_SECONDS * 1000,
        };
    }

    it("returns the bot-engine's pickId when expectedSeq matches the live seat", () => {
        const seats = [humanSeatWithPack(1)];
        const pickId = resolveAutoPickTimeout(seats, 0, 1, firstCardPick);
        expect(pickId).toBe("r0-p0-c0");
    });

    it("is a no-op (null) when expectedSeq is stale — the human already picked (seq moved on)", () => {
        const seats = [humanSeatWithPack(2)]; // live seq is now 2, schedule was for 1
        expect(resolveAutoPickTimeout(seats, 0, 1, firstCardPick)).toBeNull();
    });

    it("is a no-op when the seat currently has no pack to pick from", () => {
        const seats: LimitedEventSeat[] = [
            { seatIndex: 0, pool: [], currentPack: undefined, pickSeq: 1 },
        ];
        expect(resolveAutoPickTimeout(seats, 0, 1, firstCardPick)).toBeNull();
    });

    it("is a no-op for a Bot Drafter seat (defensive — bots are never scheduled)", () => {
        const seats: LimitedEventSeat[] = [
            {
                ...humanSeatWithPack(1),
                isBot: true,
            },
        ];
        expect(resolveAutoPickTimeout(seats, 0, 1, firstCardPick)).toBeNull();
    });

    it("is a no-op for an out-of-range seat index", () => {
        const seats = [humanSeatWithPack(1)];
        expect(resolveAutoPickTimeout(seats, 5, 1, firstCardPick)).toBeNull();
    });
});

describe("Auto-Pick timeout end-to-end: expiry → auto-pick → pack passes on (issue #1114 AC)", () => {
    it("a permanently-absent human seat's picks are all driven by resolveAutoPickTimeout and the draft still completes", () => {
        // 3 seats, all "human" (none isBot) — a real solo table where one
        // seat simply never submits a real pick. Every one of ITS picks goes
        // through the exact `autoPickSeatTimeout` sequence
        // (resolveAutoPickTimeout → applyPick → runBotAutoPicks), while the
        // other two seats are driven by scripted "real" picks — proving the
        // timeout path advances the queue exactly like a human submitPick.
        const packSlots = ["tst1"];
        const seed = 4242;
        const ABSENT_SEAT = 1;

        const started = startDraft(
            seatsOf(3),
            packSlots,
            seed,
            getConfig,
            resolveCardMeta,
            timerConfig
        );
        let round = started.draftRound;
        let remaining = started.draftPacksRemaining;
        let seats = started.seats;
        let completed = false;
        let safety = 0;

        while (!completed) {
            const seatIndex = seats.findIndex(
                (s) => s.currentPack && s.currentPack.length > 0
            );
            expect(seatIndex).not.toBe(-1);

            if (seatIndex === ABSENT_SEAT) {
                // Simulate the timer firing: the seat's own live pickSeq is
                // the "expectedSeq" a real schedule would have captured.
                const expectedSeq = seats[seatIndex].pickSeq!;
                const pickId = resolveAutoPickTimeout(
                    seats,
                    seatIndex,
                    expectedSeq,
                    firstCardPick
                );
                expect(pickId).not.toBeNull();
                const picked = applyPick(
                    seats,
                    round,
                    remaining,
                    packSlots,
                    seatIndex,
                    pickId!,
                    seed,
                    getConfig,
                    resolveCardMeta,
                    timerConfig
                );
                seats = picked.seats;
                round = picked.draftRound;
                remaining = picked.draftPacksRemaining;
                completed = picked.completed;
            } else {
                // A "real" pick from a present seat.
                const pack = seats[seatIndex].currentPack!;
                const picked = applyPick(
                    seats,
                    round,
                    remaining,
                    packSlots,
                    seatIndex,
                    pack[0].pickId,
                    seed,
                    getConfig,
                    resolveCardMeta,
                    timerConfig
                );
                seats = picked.seats;
                round = picked.draftRound;
                remaining = picked.draftPacksRemaining;
                completed = picked.completed;
            }

            if (++safety > 1000) {
                throw new Error(
                    "test: draft never completed — infinite loop guard tripped"
                );
            }
        }

        expect(remaining).toBe(0);
        for (const seat of seats) {
            expect(seat.pool).toHaveLength(3);
            expect(seat.currentPack).toBeUndefined();
        }
        // The absent seat's Pool is exactly as heuristic-coherent as any
        // other — same shape, same size — proving the timeout path is a
        // first-class substitute for a real pick, never a degraded one.
        expect(seats[ABSENT_SEAT].pool).toHaveLength(3);
    });
});

describe("runBotAutoPicks — timerConfig threaded through cascading bot picks (issue #1114)", () => {
    it("stamps a human seat that receives a fresh pack as a side effect of a bot pick", () => {
        // Seat 0 is a bot with a 1-card pack; seat 1 is human with an empty
        // currentPack (already picked, nothing queued). Seat 0's bot pick
        // empties its pack (nothing to pass — 1-card pack) — instead use a
        // 2-card pack so its remainder passes onward to the human neighbor.
        const twoCard: Record<string, BoosterConfig> = {
            lap: tinyConfig("lap", 2),
        };
        const twoCardConfig: GetBoosterConfig = (setCode) =>
            twoCard[setCode] ?? null;

        const seats: LimitedEventSeat[] = [
            {
                seatIndex: 0,
                isBot: true,
                pool: [],
                currentPack: [
                    {
                        scryfallId: "common-a",
                        cardId: "common-a",
                        cardName: "COMMON-A",
                        pickId: "pick-a",
                    },
                    {
                        scryfallId: "common-b",
                        cardId: "common-b",
                        cardName: "COMMON-B",
                        pickId: "pick-b",
                    },
                ],
            },
            { seatIndex: 1, pool: [], currentPack: undefined },
        ];

        const result = runBotAutoPicks(
            seats,
            0,
            2,
            ["lap"],
            1,
            twoCardConfig,
            resolveCardMeta,
            firstCardPick,
            false,
            timerConfig
        );

        expect(result.seats[1].currentPack).toEqual([
            {
                scryfallId: "common-b",
                cardId: "common-b",
                cardName: "COMMON-B",
                pickId: "pick-b",
            },
        ]);
        expect(result.seats[1].pickSeq).toBe(1);
        expect(result.seats[1].pickDeadline).toBe(NOW + TIMER_SECONDS * 1000);
        expect(result.timerUpdates).toEqual([{ seatIndex: 1, pickSeq: 1 }]);
    });
});
